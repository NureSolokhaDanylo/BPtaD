import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith("your_")) {
    throw new Error(`Змінна оточення ${name} не задана — заповніть її у файлі .env`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  paypalClientId: required("PAYPAL_CLIENT_ID"),
  paypalClientSecret: required("PAYPAL_CLIENT_SECRET"),
  paypalApiBase: process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com",
  currency: process.env.CURRENCY ?? "USD",
  minAmount: 1,
  maxAmount: 1000,
};
