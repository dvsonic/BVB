import { _decorator, Component, Node, director } from 'cc';
import { NetworkManager, MessageType, NetworkMessage } from '../Network/NetworkManager';
import { Logger } from '../Logger';
const { ccclass, property } = _decorator;

/**
 * 帧数据接口
 */
export interface FrameData {
    frameId: number;
    inputs: PlayerInput[];
    timestamp: number;
}

/**
 * 玩家输入接口
 */
export interface PlayerInput {
    playerId: string;
    inputType: InputType;
    inputData: any;
    timestamp: number;
}

/**
 * 输入类型枚举
 */
export enum InputType {
    MOVE = 'move',
    STOP = 'stop',
    SKILL = 'skill'
}

/**
 * 帧同步管理器
 */
@ccclass('FrameSyncManager')
export class FrameSyncManager extends Component {
    private static _instance: FrameSyncManager = null;
    
    @property
    private frameRate: number = 30; // 帧率
    
    @property
    private bufferFrames: number = 3; // 缓冲帧数
    
    @property
    private jitterBufferFrames: number = 1; // 抖动缓冲帧数
    
    private _isRunning: boolean = false;
    private _currentFrame: number = 0;
    private _frameBuffer: Map<number, FrameData> = new Map();
    // 客户端不再需要输入缓冲区
    // private _inputBuffer: Map<number, PlayerInput[]> = new Map(); 
    private _networkManager: NetworkManager = null;
    private _frameInterval: number = 0;
    private _lastFrameTime: number = 0;
    private _frameCallbacks: Function[] = [];
    private _isSynchronized: boolean = false; // 是否已同步
    private _frameTimer: any = null; // 定时器

    public static get instance(): FrameSyncManager {
        if (!FrameSyncManager._instance) {
            const node = new Node('FrameSyncManager');
            FrameSyncManager._instance = node.addComponent(FrameSyncManager);
            director.addPersistRootNode(node);
        }
        return FrameSyncManager._instance;
    }

    onLoad() {
        if (FrameSyncManager._instance && FrameSyncManager._instance !== this) {
            this.node.destroy();
            return;
        }
        FrameSyncManager._instance = this;
        this.init();
    }

    onDestroy() {
        // 组件销毁时确保清理定时器
        this.stopFrameSync();
    }

    private init(): void {
        this._networkManager = NetworkManager.instance;
        this._frameInterval = 1000 / this.frameRate;
        
        // 注册网络消息处理器
        this._networkManager.registerMessageHandler(MessageType.FRAME_DATA, this.onFrameData.bind(this));
        this._networkManager.registerMessageHandler(MessageType.GAME_START, this.onGameStart.bind(this));
    }

    /**
     * 开始帧同步
     */
    public startFrameSync(): void {
        if (this._isRunning) {
            return;
        }
        
        this._isRunning = true;
        this._isSynchronized = false;
        // 只在没有帧数据时重置当前帧，否则保持现有帧计数器
        if (this._frameBuffer.size === 0) {
            this._currentFrame = 0;
        }
        this._lastFrameTime = Date.now();
        
        console.log('帧同步开始');
        this.scheduleFrameUpdate();
    }

    /**
     * 停止帧同步
     */
    public stopFrameSync(): void {
        if (!this._isRunning) {
            return;
        }
        this._isRunning = false;
        this._isSynchronized = false;
        if (this._frameTimer) {
            clearInterval(this._frameTimer);
            this._frameTimer = null;
        }
        console.log('帧同步停止');
    }

    /**
     * 调度帧更新
     */
    private scheduleFrameUpdate(): void {
        if (this._frameTimer) {
            clearInterval(this._frameTimer);
        }
        // 使用 setInterval 替代 schedule
        this._frameTimer = setInterval(this.frameUpdate.bind(this), this._frameInterval);
    }

    /**
     * 帧更新
     */
    private frameUpdate(): void {
        if (!this._isRunning || !this._isSynchronized) {
            return;
        }
        // 动态调整播放速度以匹配服务器帧率
        const consecutiveFrames = this.getConsecutiveFramesCount();
        let framesToRun = 0;
        Logger.debug('FrameSyncManager', 'frameUpdate',this._currentFrame,"leftFrameCount",consecutiveFrames)
        // 核心逻辑修改：引入真正的抖动缓冲
        // 只有当缓冲区的帧数大于我们设定的安全缓冲时，才进行播放
        if (consecutiveFrames > this.jitterBufferFrames + 2) { 
            // 缓冲帧过多，我们落后于服务器，快进
            framesToRun = 2;
            Logger.debug('FrameSyncManager', `缓冲高 (${consecutiveFrames}), 执行2帧`)
        } else if (consecutiveFrames > this.jitterBufferFrames) { 
            // 缓冲正常（高于安全线），正常播放
            framesToRun = 1;
        } else {
            // 缓冲已低于或等于安全线，等待服务器数据，以重建缓冲
            Logger.debug('FrameSyncManager', `缓冲低 (${consecutiveFrames}), 等待帧 ${this._currentFrame}...`)
            return;
        }

        // 执行确定数量的帧
        for (let i = 0; i < framesToRun; i++) {
            const frameData = this.getFrameData(this._currentFrame);
            if (frameData) {
                this.executeFrame(frameData);
                this._currentFrame++;
            } else {
                // 此处不应到达，作为安全保护
                console.error(`[FrameSync] 逻辑错误: 尝试执行不存在的帧 ${this._currentFrame}`);
                break; 
            }
        }
    }

    /**
     * 执行帧逻辑
     */
    private executeFrame(frameData: FrameData): void {
        const fixedDeltaTime = this._frameInterval / 1000;
        // 通知所有注册的回调函数
        this._frameCallbacks.forEach(callback => {
            callback(frameData, fixedDeltaTime);
        });
    }

    /**
     * 添加输入到缓冲区
     */
    public addInput(input: PlayerInput): void {
        // 客户端不再管理输入缓冲或目标帧，直接将输入发送到服务器
        this._networkManager.sendInput(input);
    }

    /**
     * 处理服务器帧数据
     */
    private onFrameData(message: NetworkMessage): void {
        const frameData: FrameData = message.data;
        this._frameBuffer.set(frameData.frameId, frameData);

        // 如果尚未同步，则检查是否已达到启动播放所需的缓冲帧数
        if (!this._isSynchronized) {
            // 检查我们是否已经缓冲了足够的连续帧
            const minFrameId = Math.min(...this._frameBuffer.keys());
            let consecutiveFrames = 0;
            let frame = minFrameId;
            while (this._frameBuffer.has(frame)) {
                consecutiveFrames++;
                frame++;
            }

            // 如果连续帧数达到或超过了设定的缓冲帧数，则开始同步
            if (consecutiveFrames >= this.bufferFrames) {
                this._currentFrame = minFrameId;
                this._isSynchronized = true;
                console.log(`缓冲完成: 客户端从帧 ${this._currentFrame} 开始同步`);
            }
        }
        
        // 清理旧的帧数据
        this.cleanupOldFrames();
    }

    /**
     * 处理游戏开始
     */
    private onGameStart(message: NetworkMessage): void {       
        // 重置同步状态，等待服务器帧数据同步
        this._isSynchronized = false;
        
        // 开始帧同步，但不重置帧计数器
        if (!this._isRunning) {
            this._isRunning = true;
            this._lastFrameTime = Date.now();
            this.scheduleFrameUpdate();
        }
    }

    /**
     * 检查是否有帧数据
     */
    private hasFrameData(frameId: number): boolean {
        return this._frameBuffer.has(frameId);
    }

    /**
     * 获取帧数据
     */
    private getFrameData(frameId: number): FrameData {
        return this._frameBuffer.get(frameId);
    }

    /**
     * 计算从当前帧开始，我们有多少连续的帧
     */
    private getConsecutiveFramesCount(): number {
        let count = 0;
        let frame = this._currentFrame;
        while (this._frameBuffer.has(frame)) {
            count++;
            frame++;
        }
        return count;
    }

    /**
     * 清理旧的帧数据
     */
    private cleanupOldFrames(): void {
        const minFrame = this._currentFrame - 10; // 保留最近10帧
        
        for (const [frameId] of this._frameBuffer) {
            if (frameId < minFrame) {
                this._frameBuffer.delete(frameId);
            }
        }
        
        // for (const [frameId] of this._inputBuffer) {
        //     if (frameId < minFrame) {
        //         this._inputBuffer.delete(frameId);
        //     }
        // }
    }

    /**
     * 注册帧回调
     */
    public registerFrameCallback(callback: Function): void {
        this._frameCallbacks.push(callback);
    }

    /**
     * 取消注册帧回调
     */
    public unregisterFrameCallback(callback: Function): void {
        const index = this._frameCallbacks.indexOf(callback);
        if (index > -1) {
            this._frameCallbacks.splice(index, 1);
        }
    }

    /**
     * 获取当前帧
     */
    public get currentFrame(): number {
        return this._currentFrame;
    }

    /**
     * 获取运行状态
     */
    public get isRunning(): boolean {
        return this._isRunning;
    }

    /**
     * 设置帧率
     */
    public setFrameRate(rate: number): void {
        this.frameRate = rate;
        this._frameInterval = 1000 / this.frameRate;
        
        if (this._isRunning) {
            this.scheduleFrameUpdate();
        }
    }
    public getFrameRate(): number {
        return this.frameRate;
    }
}
