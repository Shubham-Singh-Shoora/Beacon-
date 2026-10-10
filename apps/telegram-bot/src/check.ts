import { loadConfig } from "./config";

// Read-only diagnostics. Never poll getUpdates or deliver a Telegram message.
async function main() {
  const { telegram } = loadConfig(["--dry-run"]);
  if (!telegram.botToken)
    throw new Error("Set TELEGRAM_BOT_TOKEN in the worker environment or root .env.");
  async function read(method: string) {
    const response = await fetch(`https://api.telegram.org/bot${telegram.botToken}/${method}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json()) as {
      ok: boolean;
      result?: {
        username?: string;
        url?: string;
        pending_update_count?: number;
        last_error_date?: number;
      };
    };
    if (!response.ok || !body.ok || !body.result)
      throw new Error(
        `Telegram ${method} failed (HTTP ${response.status}). Verify the token and connectivity.`,
      );
    return body.result;
  }
  const identity = await read("getMe");
  const webhook = await read("getWebhookInfo");
  console.log(`Token valid: @${identity.username}`);
  console.log(`Webhook configured: ${Boolean(webhook.url)}`);
  console.log(`Pending updates: ${webhook.pending_update_count ?? 0}`);
  if (webhook.url) {
    console.log(
      "This app uses long polling. Remove the existing webhook before starting it; first confirm another deployment does not own this token.",
    );
    process.exitCode = 1;
  } else {
    console.log(
      "Long polling is available. This does not prove a worker is running. Send /ping to the bot yourself to confirm hosting.",
    );
  }
}

main().catch((error: unknown) => {
  // Fetch errors can embed a URL containing the token. Print only our own messages.
  const message = error instanceof Error ? error.message : "";
  console.error(
    message.startsWith("Telegram ") || message.startsWith("Set TELEGRAM_")
      ? message
      : "Telegram check failed. Check network access and the bot token; credentials were not logged.",
  );
  process.exitCode = 1;
});
