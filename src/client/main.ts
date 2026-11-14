interface PublicConfig {
  clientId: string;
  currency: string;
  minAmount: number;
  maxAmount: number;
}

interface PayPalButtonsOptions {
  style?: Record<string, string>;
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }) => Promise<void>;
  onError: (err: unknown) => void;
  onCancel?: () => void;
}

declare global {
  interface Window {
    paypal?: { Buttons: (opts: PayPalButtonsOptions) => { render: (sel: string) => Promise<void> } };
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const amountInput = $<HTMLInputElement>("amount");
const message = $<HTMLDivElement>("message");
const currencyLabel = $<HTMLSpanElement>("currency");

function showMessage(text: string, type: "ok" | "error" | "info") {
  message.textContent = text;
  message.className = `message ${type}`;
}

function getAmount(cfg: PublicConfig): number | null {
  const v = Number(amountInput.value);
  return Number.isFinite(v) && v >= cfg.minAmount && v <= cfg.maxAmount ? v : null;
}

function loadSdk(cfg: PublicConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cfg.clientId)}&currency=${cfg.currency}&disable-funding=card,credit`;
    // nonce з нашого тегу <script> — SDK використає його для своїх inline-скриптів
    const nonce = document.querySelector<HTMLScriptElement>('script[src="/js/main.js"]')?.nonce ?? "";
    s.nonce = nonce;
    s.setAttribute("data-csp-nonce", nonce);
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("SDK не завантажився"));
    document.head.appendChild(s);
  });
}

async function init() {
  const cfg: PublicConfig = await fetch("/api/config").then((r) => r.json());
  currencyLabel.textContent = cfg.currency;
  amountInput.min = String(cfg.minAmount);
  amountInput.max = String(cfg.maxAmount);

  document.querySelectorAll<HTMLButtonElement>(".preset").forEach((btn) =>
    btn.addEventListener("click", () => {
      amountInput.value = btn.dataset.amount ?? "";
      document.querySelectorAll(".preset").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    }),
  );

  await loadSdk(cfg);

  await window.paypal!.Buttons({
    style: { layout: "vertical", color: "gold", shape: "pill", label: "donate" },
    createOrder: async () => {
      const amount = getAmount(cfg);
      if (amount === null) {
        showMessage(`Введіть суму від ${cfg.minAmount} до ${cfg.maxAmount} ${cfg.currency}`, "error");
        throw new Error("invalid amount");
      }
      showMessage("Створюємо платіж…", "info");
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data.id as string;
    },
    onApprove: async ({ orderID }) => {
      showMessage("Підтверджуємо платіж…", "info");
      const res = await fetch(`/api/orders/${orderID}/capture`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.status === "COMPLETED") {
        const name = data.payerName ? `, ${data.payerName}` : "";
        showMessage(`Дякуємо${name}! Ваш внесок ${data.amount.value} ${data.amount.currency_code} отримано 💙💛`, "ok");
      } else {
        showMessage(data.error ?? "Платіж не завершено", "error");
      }
    },
    onCancel: () => showMessage("Платіж скасовано", "info"),
    onError: (err) => {
      console.error(err);
      if (!message.classList.contains("error")) showMessage("Сталася помилка. Спробуйте ще раз.", "error");
    },
  }).render("#paypal-buttons");
}

init().catch((e) => {
  console.error(e);
  showMessage("Не вдалося завантажити сторінку оплати", "error");
});

export {};
