/**
 * Where alerts go. Telegram in normal operation, the console in `--dry-run`,
 * so the whole pipeline can be exercised without a bot token.
 */
import type { Bot } from "grammy";

export interface AlertSink {
  readonly name: string;
  send(html: string): Promise<void>;
}

export function createTelegramSink(bot: Bot, chatId: string): AlertSink {
  return {
    name: `Telegram chat ${chatId}`,
    async send(html) {
      await bot.api.sendMessage(chatId, html, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
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
