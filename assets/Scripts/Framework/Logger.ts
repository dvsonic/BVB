import { _decorator } from 'cc';

/**
 * 一个带时间戳和标签的自定义日志记录器。
 */
export class Logger {

    /**
     * 获取格式化的当前时间戳，例如 "14:23:05.123"。
     */
    private static getTimestamp(): string {
        const now = new Date();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const seconds = now.getSeconds().toString().padStart(2, '0');
        const milliseconds = now.getMilliseconds().toString().padStart(3, '0');
        return `${hours}:${minutes}:${seconds}.${milliseconds}`;
    }

    /**
     * 记录一条标准的日志信息。
     * @param tag - 日志标签，用于分类，例如 "Network", "Player"。
     * @param args - 要输出的一个或多个日志内容。
     */
    public static log(tag: string, ...args: any[]): void {
        const timestamp = this.getTimestamp();
        console.log(`[${timestamp}] [${tag}]`, ...args);
    }

    /**
     * 记录一条警告信息。
     * @param tag - 日志标签。
     * @param args - 要输出的一个或多个警告内容。
     */
    public static warn(tag: string, ...args: any[]): void {
        const timestamp = this.getTimestamp();
        console.warn(`[${timestamp}] [${tag}]`, ...args);
    }

    /**
     * 记录一条错误信息。
     * @param tag - 日志标签。
     * @param args - 要输出的一个或多个错误内容。
     */
    public static error(tag: string, ...args: any[]): void {
        const timestamp = this.getTimestamp();
        console.error(`[${timestamp}] [${tag}]`, ...args);
    }
} 