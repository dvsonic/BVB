import { _decorator, Component, Node, Prefab, director, instantiate, Color, UITransform, Vec2 } from 'cc';
import { NetworkManager, MessageType } from '../Framework/Network/NetworkManager';
import { FrameSyncManager, FrameData } from '../Framework/FrameSync/FrameSyncManager';
import { InputManager } from '../Framework/FrameSync/InputManager';
import { Ball } from './Ball';
import { Logger } from '../Framework/Logger';
import { FixedVec2, fromFloat, toFloat, DeterministicRandom } from '../Framework/FrameSync/FixedPoint';

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
    public ballMinRadius: number = 15; // 球的最小半径
    public ballMaxRadius: number = 35; // 球的最大半径
    
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
    private _playerScores: Map<string, number> = new Map(); // 玩家积分
    private _randomGenerator: DeterministicRandom = new DeterministicRandom(); // 确定性随机数生成器

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
        this._networkManager.registerMessageHandler(MessageType.SCORE_UPDATE, this.onScoreUpdate.bind(this));
        
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
        
        // 重置随机数生成器
        this._randomGenerator.setSeed(1);
        
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
        ballMinRadius?: number;
        ballMaxRadius?: number;
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
        if (config.ballMinRadius !== undefined) {
            this.ballMinRadius = config.ballMinRadius;
        }
        if (config.ballMaxRadius !== undefined) {
            this.ballMaxRadius = config.ballMaxRadius;
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
        
        // 记录玩家数量
        Logger.log('GameManager', `游戏模式: ${this._players.size === 1 ? '单人模式' : '多人模式'}, 玩家数量: ${this._players.size}`);
        
        // 设置确定性随机种子（基于房间ID和时间戳）
        const randomSeed = message.data.randomSeed || this.generateRandomSeed();
        this._randomGenerator.setSeed(randomSeed);
        Logger.log('GameManager', `设置随机种子: ${randomSeed}`);
        
        // 重置积分
        this.resetScores();
        
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
            if (ball.isAlive) {
                ball.processFrameData(frameData, fixedDeltaTime);
            }
        });
        
        // 处理碰撞检测
        this.handleCollisions();
        
        // 清理死亡的球
        this.cleanupDeadBalls();
    }

    /**
     * 处理所有球之间的碰撞
     */
    private handleCollisions(): void {
        const aliveBalls = Array.from(this._balls.values()).filter(ball => ball.isAlive);
        
        // 遍历所有球的组合，检测碰撞
        for (let i = 0; i < aliveBalls.length; i++) {
            for (let j = i + 1; j < aliveBalls.length; j++) {
                const ballA = aliveBalls[i];
                const ballB = aliveBalls[j];
                
                // 检测并处理碰撞
                if (ballA.checkCollisionWith(ballB)) {
                    ballA.handleCollisionWith(ballB);
                    
                    // 碰撞后需要重新检查存活状态
                    if (!ballA.isAlive || !ballB.isAlive) {
                        break;
                    }
                }
            }
        }
    }

    /**
     * 清理死亡的球
     */
    private cleanupDeadBalls(): void {
        const deadBalls: string[] = [];
        
        this._balls.forEach((ball, playerId) => {
            if (!ball.isAlive) {
                deadBalls.push(playerId);
            }
        });
        
        // 延迟清理，避免在遍历时修改集合
        deadBalls.forEach(playerId => {
            const ball = this._balls.get(playerId);
            if (ball) {
                ball.node.destroy();
                this._balls.delete(playerId);
                Logger.log('GameManager', `清理死亡的球: ${playerId}`);
            }
        });
        
        // 检查游戏是否结束
        this.checkGameEnd();
    }

    /**
     * 检查游戏是否结束
     */
    private checkGameEnd(): void {
        // 单人模式下不检查游戏结束
        if (this._players.size === 1) {
            return;
        }
        
        const aliveBalls = Array.from(this._balls.values()).filter(ball => ball.isAlive);
        
        if (aliveBalls.length <= 1) {
            // 游戏结束
            const winner = aliveBalls.length === 1 ? aliveBalls[0] : null;
            this.endGame(winner);
        }
    }

    /**
     * 结束游戏
     */
    private endGame(winner: Ball | null): void {
        this._gameState = GameState.FINISHED;
        
        // 停止帧同步
        this._frameSyncManager.stopFrameSync();
        
        if (winner) {
            Logger.log('GameManager', `游戏结束！获胜者: ${winner.playerId}`);
        } else {
            Logger.log('GameManager', '游戏结束！平局');
        }
        
        // 清理资源
        this._balls.forEach(ball => {
            if (ball.node) {
                ball.node.destroy();
            }
        });
        this._balls.clear();
        this._players.clear();
        
        // 可以在这里添加游戏结束的UI显示
        // 例如：this.showGameEndUI(winner);
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
        
        let index = 0;
        this._players.forEach(player => {
            // 创建小球节点
            const ballNode = instantiate(this.ballPrefab);
            const ball = ballNode.getComponent(Ball);
            
            if (ball) {
                // 设置小球属性
                ball.playerId = player.playerId;
                ball.setColor(player.color);
                
                // 设置随机大小
                const randomRadius = this._randomGenerator.nextRange(this.ballMinRadius, this.ballMaxRadius);
                ball.setRadius(randomRadius);
                Logger.log('GameManager', `玩家 ${player.playerId} 的球随机大小: ${randomRadius.toFixed(2)} (范围: ${this.ballMinRadius}-${this.ballMaxRadius})`);
                
                // 设置初始位置（传递球的半径）
                const position = this.getSpawnPosition(index, randomRadius);
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
    private getSpawnPosition(index: number, ballRadius: number = 25): FixedVec2 {
        const baseDistance = 80; // 基础距离
        const minDistance = baseDistance + ballRadius * 2; // 根据球半径调整最小距离
        const maxAttempts = 50; // 最大尝试次数
        
        // 计算可用的生成区域（考虑小球半径）
        const spawnWidth = this.gameAreaWidth - ballRadius * 2;
        const spawnHeight = this.gameAreaHeight - ballRadius * 2;
        
        // 尝试生成随机位置
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            // 使用确定性随机数生成器生成随机位置
            const x = (this._randomGenerator.next() - 0.5) * spawnWidth;
            const y = (this._randomGenerator.next() - 0.5) * spawnHeight;
            const position = new FixedVec2(fromFloat(x), fromFloat(y));
            
            Logger.log('GameManager', `尝试生成位置 ${attempt}: (${x.toFixed(2)}, ${y.toFixed(2)}), 球半径: ${ballRadius.toFixed(2)}, 种子状态: ${this._randomGenerator.getSeed()}`);
            
            // 检查与已有小球的距离
            let validPosition = true;
            for (const existingBall of this._balls.values()) {
                if (existingBall.isAlive) {
                    const existingPos = existingBall.getPosition();
                    const dx = position.x - existingPos.x;
                    const dy = position.y - existingPos.y;
                    const distanceSqr = dx * dx + dy * dy;
                    
                    // 计算两球半径之和加上额外间距
                    const requiredDistance = ballRadius + existingBall.radius + baseDistance;
                    const requiredDistanceSqr = fromFloat(requiredDistance * requiredDistance);
                    
                    if (distanceSqr < requiredDistanceSqr) {
                        validPosition = false;
                        break;
                    }
                }
            }
            
            if (validPosition) {
                Logger.log('GameManager', `成功生成位置 (${x.toFixed(2)}, ${y.toFixed(2)}), 尝试次数: ${attempt + 1}`);
                return position;
            }
        }
        
        // 如果随机生成失败，使用固定位置作为备用
        const safeMargin = ballRadius + 50; // 确保球不会超出边界
        const fallbackPositions = [
            new FixedVec2(fromFloat(-Math.min(200, this.gameAreaWidth / 2 - safeMargin)), fromFloat(0)),
            new FixedVec2(fromFloat(Math.min(200, this.gameAreaWidth / 2 - safeMargin)), fromFloat(0)),
            new FixedVec2(fromFloat(0), fromFloat(Math.min(200, this.gameAreaHeight / 2 - safeMargin))),
            new FixedVec2(fromFloat(0), fromFloat(-Math.min(200, this.gameAreaHeight / 2 - safeMargin)))
        ];
        
        const fallbackPosition = fallbackPositions[index % fallbackPositions.length];
        Logger.log('GameManager', `使用回退位置 (${toFloat(fallbackPosition.x).toFixed(2)}, ${toFloat(fallbackPosition.y).toFixed(2)}), 球半径: ${ballRadius.toFixed(2)}`);
        return fallbackPosition;
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

    /**
     * 获取当前帧ID
     */
    public getCurrentFrame(): number {
        return this._frameSyncManager ? this._frameSyncManager.currentFrame : 0;
    }

    /**
     * 获取确定性随机数生成器
     */
    public getRandomGenerator(): DeterministicRandom {
        return this._randomGenerator;
    }

    /**
     * 获取是否为单人模式
     */
    public get isSinglePlayerMode(): boolean {
        return this._players.size === 1;
    }

    /**
     * 处理玩家获得积分
     */
    public onPlayerScore(
        killerPlayerId: string, 
        victimPlayerId: string, 
        score: number, 
        frameId: number,
        killerRadius: number,
        victimRadius: number
    ): void {
        // 更新本地积分
        const currentScore = this._playerScores.get(killerPlayerId) || 0;
        this._playerScores.set(killerPlayerId, currentScore + score);
        
        // 发送积分事件到服务器（包含去重信息）
        this.sendScoreEvent(killerPlayerId, victimPlayerId, score, frameId, killerRadius, victimRadius);
        
        Logger.log('GameManager', `玩家 ${killerPlayerId} 获得积分: ${score}，总积分: ${currentScore + score}`);
    }

    /**
     * 发送积分事件到服务器
     */
    private sendScoreEvent(
        killerPlayerId: string, 
        victimPlayerId: string, 
        score: number, 
        frameId: number,
        killerRadius: number,
        victimRadius: number
    ): void {
        if (this._networkManager) {
            // 创建事件唯一标识
            const eventId = `${frameId}_${killerPlayerId}_${victimPlayerId}_${score}`;
            
            this._networkManager.sendMessage({
                type: MessageType.PLAYER_SCORE,
                data: {
                    eventId,
                    frameId,
                    killerPlayerId,
                    victimPlayerId,
                    score,
                    killerRadius,
                    victimRadius,
                    timestamp: Date.now()
                }
            });
        }
    }

    /**
     * 处理服务器积分更新
     */
    private onScoreUpdate(message: any): void {
        const { eventId, frameId, killerPlayerId, victimPlayerId, score, totalScore } = message.data;
        
        // 更新本地积分缓存
        this._playerScores.set(killerPlayerId, totalScore);
        
        Logger.log('GameManager', `收到积分更新: ${killerPlayerId} 获得 ${score} 分，总积分: ${totalScore} (事件ID: ${eventId}, 帧: ${frameId})`);
        
        // 可以在这里触发UI更新等
        // 例如：this.updateScoreUI(killerPlayerId, totalScore);
    }

    /**
     * 获取玩家积分
     */
    public getPlayerScore(playerId: string): number {
        return this._playerScores.get(playerId) || 0;
    }

    /**
     * 获取所有玩家积分
     */
    public getAllPlayerScores(): Map<string, number> {
        return new Map(this._playerScores);
    }

    /**
     * 重置所有玩家积分
     */
    private resetScores(): void {
        this._playerScores.clear();
        this._players.forEach(player => {
            this._playerScores.set(player.playerId, 0);
        });
        Logger.log('GameManager', '所有玩家积分已重置');
    }

    /**
     * 生成随机种子（基于房间ID和时间戳）
     */
    private generateRandomSeed(): number {
        // 使用房间ID和时间戳生成确定性种子
        let hash = 0;
        const str = this._roomId + this._gameStartTime.toString();
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        return Math.abs(hash);
    }

    /**
     * 测试确定性随机数生成器
     */
    public testDeterministicRandom(): void {
        console.log('=== 确定性随机数测试 ===');
        
        // 使用相同种子生成两个随机数生成器
        const testSeed = 12345;
        const rng1 = new DeterministicRandom(testSeed);
        const rng2 = new DeterministicRandom(testSeed);
        
        // 生成10个随机数并比较
        for (let i = 0; i < 10; i++) {
            const num1 = rng1.next();
            const num2 = rng2.next();
            console.log(`序列 ${i}: ${num1.toFixed(6)} vs ${num2.toFixed(6)}, 相等: ${num1 === num2}`);
        }
        
        // 测试当前游戏的随机数生成器
        console.log('当前游戏随机种子:', this._randomGenerator.getSeed());
        console.log('生成测试位置:');
        for (let i = 0; i < 3; i++) {
            const x = (this._randomGenerator.next() - 0.5) * 800;
            const y = (this._randomGenerator.next() - 0.5) * 600;
            console.log(`位置 ${i}: (${x.toFixed(2)}, ${y.toFixed(2)})`);
        }
    }

    /**
     * 测试单人模式
     */
    public testSinglePlayerMode(): void {
        console.log('=== 单人模式测试 ===');
        console.log('当前游戏状态:', this._gameState);
        console.log('是否为单人模式:', this.isSinglePlayerMode);
        console.log('玩家数量:', this._players.size);
        console.log('小球数量:', this._balls.size);
        console.log('球大小范围:', `${this.ballMinRadius}-${this.ballMaxRadius}`);
        
        // 显示当前球的大小信息
        this._balls.forEach((ball, playerId) => {
            console.log(`球 ${playerId}: 半径 ${ball.radius.toFixed(2)}, 存活: ${ball.isAlive}`);
        });
    }

    /**
     * 测试随机大小功能
     */
    public testRandomBallSize(): void {
        console.log('=== 随机球大小测试 ===');
        console.log('当前随机种子:', this._randomGenerator.getSeed());
        console.log('球大小范围:', `${this.ballMinRadius}-${this.ballMaxRadius}`);
        
        // 生成10个测试大小
        const testSizes = [];
        for (let i = 0; i < 10; i++) {
            const size = this._randomGenerator.nextRange(this.ballMinRadius, this.ballMaxRadius);
            testSizes.push(size);
            console.log(`测试大小 ${i + 1}: ${size.toFixed(2)}`);
        }
        
        // 统计信息
        const minSize = Math.min(...testSizes);
        const maxSize = Math.max(...testSizes);
        const avgSize = testSizes.reduce((a, b) => a + b, 0) / testSizes.length;
        
        console.log(`统计信息: 最小 ${minSize.toFixed(2)}, 最大 ${maxSize.toFixed(2)}, 平均 ${avgSize.toFixed(2)}`);
    }
}