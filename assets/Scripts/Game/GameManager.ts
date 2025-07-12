import { Node, director, instantiate, Prefab, Vec2, Color, Canvas, UITransform } from 'cc';
import { NetworkManager, MessageType } from '../Framework/Network/NetworkManager';
import { FrameSyncManager, FrameData } from '../Framework/FrameSync/FrameSyncManager';
import { InputManager } from '../Framework/FrameSync/InputManager';
import { Ball } from './Ball';

/**
 * 游戏状态枚举
 */
export enum GameState {
    WAITING = 'waiting',
    PLAYING = 'playing',
    PAUSED = 'paused',
    FINISHED = 'finished'
}

/**
 * 玩家信息接口
 */
export interface PlayerInfo {
    playerId: string;
    nickname: string;
    color: Color;
    ballNode?: Node;
}

/**
 * 游戏管理器单例
 */
export class GameManager {
    private static _instance: GameManager = null;
    
    public ballPrefab: Prefab = null;
    public gameArea: Node = null;
    public maxPlayers: number = 4;
    public gameAreaWidth: number = 720;
    public gameAreaHeight: number = 1280;
    
    private _networkManager: NetworkManager = null;
    private _frameSyncManager: FrameSyncManager = null;
    private _inputManager: InputManager = null;
    private _gameState: GameState = GameState.WAITING;
    private _players: Map<string, PlayerInfo> = new Map();
    private _balls: Map<string, Ball> = new Map();
    private _myPlayerId: string = '';
    private _roomId: string = '';
    private _ownerId: string = ''; // 新增房主ID
    private _gameStartTime: number = 0;

    // 用于修复内存泄漏的绑定函数
    private _boundOnRoomInfo: (message: any) => void;
    private _boundOnGameStart: (message: any) => void;
    private _boundOnFrameUpdate: (frameData: FrameData, fixedDeltaTime: number) => void;

    private constructor() {
        // 私有构造函数，防止外部实例化
    }

    /**
     * 获取单例实例
     */
    public static get instance(): GameManager {
        if (!GameManager._instance) {
            GameManager._instance = new GameManager();
        }
        return GameManager._instance;
    }

    /**
     * 初始化游戏管理器
     */
    public init(): void {
        // 获取管理器实例
        this._networkManager = NetworkManager.instance;
        this._frameSyncManager = FrameSyncManager.instance;
        this._inputManager = InputManager.instance;
        
        // 绑定函数引用
        this._boundOnRoomInfo = this.onRoomInfo.bind(this);
        this._boundOnGameStart = this.onGameStart.bind(this);
        this._boundOnFrameUpdate = this.onFrameUpdate.bind(this);

        // 注册网络消息处理器
        this._networkManager.registerMessageHandler(MessageType.ROOM_INFO, this._boundOnRoomInfo);
        this._networkManager.registerMessageHandler(MessageType.GAME_START, this._boundOnGameStart);
        
        // 注册帧同步回调
        this._frameSyncManager.registerFrameCallback(this._boundOnFrameUpdate);
        
        // 获取我的玩家ID
        this._myPlayerId = this._networkManager.playerId;
    }

    /**
     * 清理资源
     */
    public cleanup(): void {
        // 取消注册
        if (this._networkManager) {
            this._networkManager.unregisterMessageHandler(MessageType.ROOM_INFO, this._boundOnRoomInfo);
            this._networkManager.unregisterMessageHandler(MessageType.GAME_START, this._boundOnGameStart);
        }
        
        if (this._frameSyncManager) {
            this._frameSyncManager.unregisterFrameCallback(this._boundOnFrameUpdate);
        }
    }

    /**
     * 重置游戏管理器状态
     */
    public reset(): void {
        this._gameState = GameState.WAITING;
        this._players.clear();
        this._balls.clear();
        this._myPlayerId = '';
        this._roomId = '';
        this._ownerId = ''; // 重置房主ID
        this._gameStartTime = 0;
        
        // 清理所有小球节点
        this._balls.forEach(ball => {
            if (ball.node) {
                ball.node.destroy();
            }
        });
        this._balls.clear();
    }

    /**
     * 获取房间ID
     */
    public get roomId(): string {
        return this._roomId;
    }

    /**
     * 设置游戏区域节点
     */
    public setGameArea(gameArea: Node): void {
        this.gameArea = gameArea;
        this.gameAreaWidth = this.gameArea.getComponent(UITransform).width;
        this.gameAreaHeight = this.gameArea.getComponent(UITransform).height;
    }

    /**
     * 设置小球预制体
     */
    public setBallPrefab(ballPrefab: Prefab): void {
        this.ballPrefab = ballPrefab;
    }

    /**
     * 设置游戏配置
     */
    public setGameConfig(config: {
        maxPlayers?: number;
        gameAreaWidth?: number;
        gameAreaHeight?: number;
    }): void {
        if (config.maxPlayers !== undefined) {
            this.maxPlayers = config.maxPlayers;
        }
        if (config.gameAreaWidth !== undefined) {
            this.gameAreaWidth = config.gameAreaWidth;
        }
        if (config.gameAreaHeight !== undefined) {
            this.gameAreaHeight = config.gameAreaHeight;
        }
    }

    /**
     * 开始游戏
     */
    public startGame(): void {
        if (this._gameState !== GameState.WAITING) {
            console.warn('游戏已经开始或处于其他状态');
            return;
        }
        
        // 连接到服务器
        this._networkManager.connect().then(() => {
            this.joinRoom();
        }).catch(error => {
            console.error('连接服务器失败:', error);
        });
    }

    /**
     * 加入房间
     */
    private joinRoom(): void {
        this._roomId = 'room_' + Date.now(); // 简单的房间ID生成
        this._networkManager.joinRoom(this._roomId);
    }

    /**
     * 房主请求开始游戏
     */
    public requestGameStart(): void {
        if (this._myPlayerId !== this._ownerId) {
            console.warn('只有房主才能开始游戏');
            return;
        }
        if (this._gameState !== GameState.WAITING) {
            console.warn('游戏已经开始或不处于等待状态');
            return;
        }
        
        this._networkManager.sendMessage({
            type: MessageType.GAME_START,
            data: {}
        });
    }

    /**
     * 处理房间信息
     */
    private onRoomInfo(message: any): void {
        const roomData = message.data;
        this._roomId = roomData.roomId;
        this._ownerId = roomData.ownerId;
        
        const serverPlayers = new Map<string, any>();
        if (roomData.players) {
            roomData.players.forEach((playerData: any) => {
                serverPlayers.set(playerData.playerId, playerData);
            });
        }
    
        // 移除已离开的玩家
        this._players.forEach((playerInfo, playerId) => {
            if (!serverPlayers.has(playerId)) {
                if (playerInfo.ballNode) {
                    playerInfo.ballNode.destroy();
                }
                this._players.delete(playerId);
                this._balls.delete(playerId);
            }
        });
    
        // 添加新玩家
        serverPlayers.forEach((playerData, playerId) => {
            if (!this._players.has(playerId)) {
                this.addPlayer(playerData);
            }
        });
    }

    /**
     * 处理游戏开始
     */
    private onGameStart(message: any): void {
        if (this._gameState === GameState.PLAYING) {
            console.warn('游戏已开始，忽略重复的开始指令。');
            return;
        }
        this._gameState = GameState.PLAYING;
        this._gameStartTime = Date.now();
        
        // 创建所有玩家的小球
        this.createPlayerBalls();
        
        // 开始帧同步
        this._frameSyncManager.startFrameSync();
    }

    /**
     * 处理游戏状态 - 已移除，与帧同步模型冲突
     */
    // private onGameState(message: any): void {
    //     const gameStateData = message.data;
        
    //     // 更新游戏状态
    //     this._gameState = gameStateData.state;
        
    //     // 同步玩家位置等信息
    //     if (gameStateData.players) {
    //         this.syncPlayerStates(gameStateData.players);
    //     }
    // }

    /**
     * 帧更新处理
     */
    private onFrameUpdate(frameData: FrameData, fixedDeltaTime: number): void {
        // 让所有小球处理帧数据
        this._balls.forEach(ball => {
            ball.processFrameData(frameData, fixedDeltaTime);
        });
    }

    /**
     * 添加玩家
     */
    private addPlayer(playerData: any): void {
        const playerId = playerData.playerId;
        
        if (this._players.has(playerId)) {
            return;
        }
        
        const playerInfo: PlayerInfo = {
            playerId: playerId,
            nickname: playerData.nickname || `Player${this._players.size + 1}`,
            color: this.getPlayerColor(this._players.size)
        };
        
        this._players.set(playerId, playerInfo);
    }

    /**
     * 获取玩家颜色
     */
    private getPlayerColor(index: number): Color {
        const colors = [
            Color.RED,
            Color.BLUE,
            Color.GREEN,
            Color.YELLOW,
            Color.MAGENTA,
            Color.CYAN
        ];
        return colors[index % colors.length];
    }

    /**
     * 创建玩家小球
     */
    private createPlayerBalls(): void {
        if (!this.ballPrefab) {
            console.error('小球预制体未设置');
            return;
        }
        console.log('createPlayerBalls', this._players);
        
        let index = 0;
        this._players.forEach(player => {
            // 创建小球节点
            const ballNode = instantiate(this.ballPrefab);
            const ball = ballNode.getComponent(Ball);
            
            if (ball) {
                // 设置小球属性
                ball.playerId = player.playerId;
                ball.setColor(player.color);
                
                // 设置初始位置
                const position = this.getSpawnPosition(index);
                ball.setPosition(position);
                
                // 添加到游戏区域
                this.gameArea.addChild(ballNode);
                
                // 记录小球和玩家信息
                this._balls.set(player.playerId, ball);
                player.ballNode = ballNode;
            }
            
            index++;
        });
    }

    /**
     * 获取出生位置
     */
    private getSpawnPosition(index: number): Vec2 {
        const positions = [
            new Vec2(-200, 0),
            new Vec2(200, 0),
            new Vec2(0, 200),
            new Vec2(0, -200)
        ];
        
        return positions[index % positions.length];
    }

    /**
     * 同步玩家状态 - 已移除，与帧同步模型冲突
     */
    // private syncPlayerStates(playersData: any[]): void {
    //     playersData.forEach(playerData => {
    //         const ball = this._balls.get(playerData.playerId);
    //         if (ball && playerData.position) {
    //             ball.setPosition(new Vec2(playerData.position.x, playerData.position.y));
    //         }
    //     });
    // }

    /**
     * 获取游戏状态
     */
    public get gameState(): GameState {
        return this._gameState;
    }

    /**
     * 获取玩家数量
     */
    public get playerCount(): number {
        return this._players.size;
    }

    /**
     * 获取我的小球
     */
    public getMyBall(): Ball | null {
        return this._balls.get(this._myPlayerId) || null;
    }

    /**
     * 获取房主ID
     */
    public get ownerId(): string {
        return this._ownerId;
    }

    /**
     * 暂停游戏
     */
    public pauseGame(): void {
        if (this._gameState === GameState.PLAYING) {
            this._gameState = GameState.PAUSED;
            this._frameSyncManager.stopFrameSync();
        }
    }

    /**
     * 恢复游戏
     */
    public resumeGame(): void {
        if (this._gameState === GameState.PAUSED) {
            this._gameState = GameState.PLAYING;
            this._frameSyncManager.startFrameSync();
        }
    }

    /**
     * 结束游戏
     */
    public endGame(): void {
        this._gameState = GameState.FINISHED;
        
        if (this._frameSyncManager) {
            this._frameSyncManager.stopFrameSync();
        }
        
        // 清理资源
        this._balls.forEach(ball => {
            if (ball.node) {
                ball.node.destroy();
            }
        });
        this._balls.clear();
        this._players.clear();
    }

    /**
     * 检查是否已初始化
     */
    public get isInitialized(): boolean {
        return this._networkManager !== null && this._frameSyncManager !== null;
    }

    /**
     * 测试输入系统
     */
    public testInputSystem(): void {
        console.log('=== 输入系统测试 ===');
        console.log('游戏状态:', this._gameState);
        console.log('帧同步运行:', this._frameSyncManager?.isRunning);
        console.log('网络连接:', this._networkManager?.isConnected);
    }
}