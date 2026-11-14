import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { createOrder, captureOrder } from "./paypal.js";

const app = express();
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
const indexHtml = readFileSync(path.join(publicDir, "index.html"), "utf8");

// Унікальний nonce на кожен запит — дозволяє inline-скрипти PayPal SDK без 'unsafe-inline'
app.use((_req, res, next) => {
  res.locals.nonce = randomBytes(16).toString("base64");
  next();
});

app.use(
  helmet({
    // PayPal відкриває popup і спілкується з ним через window.opener
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          (_req, res) => `'nonce-${(res as express.Response).locals.nonce}'`,
          "https://*.paypal.com",
          "https://*.paypalobjects.com",
        ],
        frameSrc: ["https://*.paypal.com", "https://*.paypalobjects.com"],
        connectSrc: ["'self'", "https://*.paypal.com", "https://*.paypalobjects.com"],
        imgSrc: ["'self'", "data:", "https://*.paypal.com", "https://*.paypalobjects.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  }),
);
app.use(express.json({ limit: "10kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 30 }));

// index.html віддаємо з підставленим nonce
app.get(["/", "/index.html"], (_req, res) => {
  res.type("html").send(indexHtml.replaceAll("__CSP_NONCE__", res.locals.nonce));
});
app.use(express.static(publicDir, { index: false }));

// Публічна конфігурація: client-id не є секретом, secret залишається на сервері
app.get("/api/config", (_req, res) => {
  res.json({
    clientId: config.paypalClientId,
    currency: config.currency,
    minAmount: config.minAmount,
    maxAmount: config.maxAmount,
  });
});

app.post("/api/orders", async (req, res) => {
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount < config.minAmount || amount > config.maxAmount) {
    return res.status(400).json({ error: `Сума має бути від ${config.minAmount} до ${config.maxAmount}` });
  }
  try {
    const order = await createOrder(amount.toFixed(2)); // сума формується тільки на сервері
    res.json({ id: order.id });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "Не вдалося створити платіж" });
  }
});

app.post("/api/orders/:orderId/capture", async (req, res) => {
  const { orderId } = req.params;
  if (!/^[A-Z0-9]{10,30}$/.test(orderId)) return res.status(400).json({ error: "Невірний ID замовлення" });
  try {
    const result = await captureOrder(orderId);
    const capture = result.purchase_units[0]?.payments.captures[0];
    // Тут у реальному проєкті — запис у БД
    console.log(`Донат: ${capture?.amount.value} ${capture?.amount.currency_code}, capture ${capture?.id}`);
    res.json({
      status: result.status,
      amount: capture?.amount,
      payerName: result.payer?.name?.given_name,
    });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "Не вдалося підтвердити платіж" });
  }
});

app.listen(config.port, () => console.log(`Сервер: http://localhost:${config.port}`));
