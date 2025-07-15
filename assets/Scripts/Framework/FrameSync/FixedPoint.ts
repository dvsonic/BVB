import { _decorator, Component, Node } from 'cc';

const { ccclass, property } = _decorator;

// --- 配置 ---
// 我们用一个普通的 number 类型来存储定点数。
// JS 的 number 是64位浮点数，但其整数部分可以精确表示到53位，
// 对于32位的定点数（16位整数.16位小数）来说绰绰有余。

/**
 * 定点数小数部分所占的位数
 */
const PRECISION = 16;

/**
 * 缩放因子 (2^PRECISION)
 */
const FACTOR = 1 << PRECISION;

/**
 * 用于计算乘法时的中间量，防止溢出
 */
const FACTOR_BI = BigInt(FACTOR);

// --- 基础运算 ---

/**
 * 将浮点数转换为定点数
 */
export function fromFloat(n: number): number {
    return Math.round(n * FACTOR);
}

/**
 * 将定点数转换为浮点数 (主要用于渲染)
 */
export function toFloat(n: number): number {
    return n / FACTOR;
}

/**
 * 定点数乘法
 */
export function fMul(a: number, b: number): number {
    // 使用 BigInt 来执行乘法，避免中间结果溢出 number 的安全整数范围
    return Number((BigInt(a) * BigInt(b)) / FACTOR_BI);
}

/**
 * 定点数除法
 */
export function fDiv(a: number, b: number): number {
    // 使用 BigInt 来执行，先将a放大，再做除法，保证精度
    return Number((BigInt(a) * FACTOR_BI) / BigInt(b));
}

/**
 * 定点数开方 (使用牛顿迭代法，仅适用于正数)
 */
export function fSqrt(n: number): number {
    if (n <= 0) return 0;
    // 将其转换为一个大整数以保留精度
    const n_bi = BigInt(n) << BigInt(PRECISION);

    // 使用位运算得到一个更稳健的初始猜测值，避免浮点数转换带来的精度问题和错误
    const bitLength = BigInt(n_bi.toString(2).length);
    let x = 1n << (bitLength / 2n);
    if (x === 0n) { // 处理 n_bi 为 0 的边界情况
        return 0;
    }
    
    // 牛顿迭代法
    for (let i = 0; i < 8; i++) { // 增加迭代次数以获得更好的精度
        x = (x + n_bi / x) >> 1n;
    }
    
    return Number(x);
}


/**
 * 用于定点数运算的二维向量
 */
export class FixedVec2 {
    public x: number;
    public y: number;

    constructor(x: number = 0, y: number = 0) {
        this.x = x;
        this.y = y;
    }

    public static from(v: {x: number, y: number}): FixedVec2 {
        return new FixedVec2(v.x, v.y);
    }
    
    public clone(): FixedVec2 {
        return new FixedVec2(this.x, this.y);
    }

    public set(x: number, y: number): void {
        this.x = x;
        this.y = y;
    }

    public add(other: FixedVec2): FixedVec2 {
        this.x += other.x;
        this.y += other.y;
        return this;
    }

    public multiplyScalar(s: number): FixedVec2 {
        this.x = fMul(this.x, s);
        this.y = fMul(this.y, s);
        return this;
    }

    public lengthSqr(): number {
        const x2 = fMul(this.x, this.x);
        const y2 = fMul(this.y, this.y);
        return x2 + y2;
    }

    public length(): number {
        return fSqrt(this.lengthSqr());
    }

    public normalize(): FixedVec2 {
        const len = this.length();
        if (len === 0) return this;
        this.x = fDiv(this.x, len);
        this.y = fDiv(this.y, len);
        return this;
    }
} 

/**
 * 确定性随机数生成器 (基于线性同余发生器)
 * 保证所有客户端使用相同种子时产生相同的随机数序列
 */
export class DeterministicRandom {
    private seed: number;
    private readonly a: number = 1664525;
    private readonly c: number = 1013904223;
    private readonly m: number = 0x100000000; // 2^32
    
    constructor(seed: number = 1) {
        this.seed = seed;
    }
    
    /**
     * 设置随机种子
     */
    public setSeed(seed: number): void {
        this.seed = seed;
    }
    
    /**
     * 获取当前种子
     */
    public getSeed(): number {
        return this.seed;
    }
    
    /**
     * 生成下一个随机数 [0, 1)
     */
    public next(): number {
        this.seed = (this.a * this.seed + this.c) % this.m;
        return this.seed / this.m;
    }
    
    /**
     * 生成指定范围的随机数 [min, max)
     */
    public nextRange(min: number, max: number): number {
        return min + this.next() * (max - min);
    }
    
    /**
     * 生成指定范围的随机整数 [min, max]
     */
    public nextInt(min: number, max: number): number {
        return Math.floor(this.nextRange(min, max + 1));
    }
    
    /**
     * 生成随机布尔值
     */
    public nextBoolean(): boolean {
        return this.next() < 0.5;
    }
}

/**
 * 全局确定性随机数生成器实例
 */
export const globalRandom = new DeterministicRandom(); 