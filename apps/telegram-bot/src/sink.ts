/**
 * Where alerts go. Telegram in normal operation, the console in `--dry-run`,
 * so the whole pipeline can be exercised without a bot token.
 */
import type { Bot } from "grammy";
import { setTimeout as sleep } from "node:timers/promises";

export interface AlertSink {
  readonly name: string;
  send(html: string): Promise<void>;
}

const queues = new WeakMap<Bot, Map<string, Promise<void>>>();

export async function retryTelegramRateLimit(
  send: () => Promise<unknown>,
  wait: (ms: number) => Promise<unknown> = sleep,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await send();
      return;
    } catch (error) {
      const failure = error as { error_code?: number; parameters?: { retry_after?: number } };
      const seconds = failure?.parameters?.retry_after;
      // 429 explicitly means Telegram rejected delivery. Do not replay an
      // ambiguous network failure, which might already have delivered a message.
      if (
        failure?.error_code !== 429 ||
        attempt >= 2 ||
        !Number.isFinite(seconds) ||
        seconds! < 0 ||
        seconds! > 30
      )
        throw error;
      await wait(Math.max(1, seconds!) * 1000);
    }
  }
}

export function createTelegramSink(bot: Bot, chatId: string): AlertSink {
  let pending = queues.get(bot);
  if (!pending) {
    pending = new Map();
    queues.set(bot, pending);
  }
  const chatQueue = pending;
  return {
    name: `Telegram chat ${chatId}`,
    async send(html) {
      const delivery = (chatQueue.get(chatId) ?? Promise.resolve()).then(() =>
        retryTelegramRateLimit(() =>
          bot.api.sendMessage(chatId, html, {
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
          }),
        ),
      );
      // Space messages in the same chat, including command replies and alerts.
      // Other chats can receive immediately, and idle queue entries are removed.
      const cooling = delivery.then(
        () => sleep(1050),
        () => sleep(1050),
      );
      chatQueue.set(chatId, cooling);
      void cooling.then(() => {
        if (chatQueue.get(chatId) === cooling) chatQueue.delete(chatId);
      });
      await delivery;
    },
  };
}

/**
 * Render Telegram HTML as readable terminal text.
 * Good enough to eyeball copy and formatting without a Telegram account.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<a href="([^"]*)">([^<]*)<\/a>/g, "$2 ($1)")
    .replace(/<\/?b>/g, "")
    .replace(/<\/?i>/g, "")
    .replace(/<\/?code>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function createConsoleSink(): AlertSink {
  return {
    name: "console (dry run)",
    async send(html) {
      console.log("\n" + "=".repeat(64));
      console.log(htmlToPlainText(html));
      console.log("=".repeat(64));
    },
  };
}
