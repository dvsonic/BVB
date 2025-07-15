import { _decorator, Component, Node, Vec2, Vec3, Color, Sprite } from 'cc';
import { FrameData, PlayerInput, InputType } from '../Framework/FrameSync/FrameSyncManager';
import { MoveInputData } from '../Framework/FrameSync/InputManager';
import { FixedVec2, fromFloat, toFloat, fMul, fDiv } from '../Framework/FrameSync/FixedPoint';
import { GameManager } from './GameManager';
import { Logger } from '../Framework/Logger';

const { ccclass, property } = _decorator;

/**
 * 小球实体类
 */
@ccclass('Ball')
export class Ball extends Component {
    @property
    public playerId: string = '';
    
    @property
    public ballColor: Color = Color.WHITE;

    @property
    public radius: number = 25;
    
    @property
    public isAlive: boolean = true; // 球是否存活
    
    @property
    public maxSpeed: number = 200; // 最大移动速度
    
    private _radius_fp: number = 0;
    
    // --- 使用定点数进行物理计算 ---
    private _position: FixedVec2 = new FixedVec2();
    private _velocity: FixedVec2 = new FixedVec2();

    // --- 用于渲染插值 ---
    private _previousPosition: FixedVec2 = new FixedVec2();
    private _renderPosition: FixedVec2 = new FixedVec2(); // 当前渲染位置
    private _timeSinceLastLogicUpdate: number = 0;
    private _logicFrameInterval: number = 1 / 30; // 默认值, 会被动态更新

    onLoad() {
        this.init();
    }

    private init(): void {
        // --- 将配置的浮点数转换为定点数 ---
        this._radius_fp = fromFloat(this.radius);
        
        const sprite = this.node.getComponent(Sprite);
        if (sprite) {
            sprite.color = this.ballColor;
        }
        this.node.setScale(this.radius * 2 / 100, this.radius * 2 / 100);

        const initialPos = new FixedVec2(fromFloat(this.node.position.x), fromFloat(this.node.position.y));
        this._position.set(initialPos.x, initialPos.y);
        this._previousPosition.set(initialPos.x, initialPos.y);
        this._renderPosition.set(initialPos.x, initialPos.y);
    }

    /**
     * 渲染更新 (每渲染帧调用)
     * @param deltaTime 
     */
    update(deltaTime: number): void {
        this._timeSinceLastLogicUpdate += deltaTime;
        
        // 计算插值因子，确保不超过1
        const alpha = Math.min(this._timeSinceLastLogicUpdate / this._logicFrameInterval, 1.0);

        // 使用传统插值：从上一帧位置向当前帧位置插值
        const prevX = toFloat(this._previousPosition.x);
        const prevY = toFloat(this._previousPosition.y);
        const currentX = toFloat(this._position.x);
        const currentY = toFloat(this._position.y);

        const renderX = prevX + (currentX - prevX) * alpha;
        const renderY = prevY + (currentY - prevY) * alpha;
        
        const step = renderY - this.node.position.y;
        
        // 只在移动幅度较大时输出调试信息，避免性能影响
        if (Math.abs(step) > 0.0001) { // 提高阈值，减少日志输出
            Logger.debug('Ball', `step:${step.toFixed(3)} deltaTime:${deltaTime.toFixed(6)}`);
        }
        
        // 更新节点位置
        this.node.setPosition(renderX, renderY);
    }

    /**
     * 处理帧数据 (每逻辑帧调用)
     */
    public processFrameData(frameData: FrameData, fixedDeltaTime: number): void {
        this._previousPosition.set(this._position.x, this._position.y);
        
        // 更新逻辑帧间隔（只在需要时更新）
        if (Math.abs(this._logicFrameInterval - fixedDeltaTime) > 0.001) {
            this._logicFrameInterval = fixedDeltaTime;
        }
        
        const fixedDeltaTime_fp = fromFloat(fixedDeltaTime);

        const playerInput = frameData.inputs.find(input => input.playerId === this.playerId);
        
        if (playerInput) {
            this.processPlayerInput(playerInput);
        }
        
        // 更新物理状态
        this.updatePhysics(fixedDeltaTime_fp);
        // 重置插值计时器
        this._timeSinceLastLogicUpdate = 0;
    }

    /**
     * 处理玩家输入
     */
    private processPlayerInput(input: PlayerInput): void {
        switch (input.inputType) {
            case InputType.MOVE:
                this.handleMoveInput(input.inputData as MoveInputData);
                break;
            case InputType.STOP:
                this.handleStopInput();
                break;
        }
    }

    /**
     * 处理移动输入
     */
    private handleMoveInput(inputData: MoveInputData): void {
        if (!inputData || !inputData.direction) {
            // 如果数据不完整，可以视为无效输入，保持上一帧状态
            return;
        }

        // 计算方向向量的长度
        const directionLength = Math.sqrt(inputData.direction.x * inputData.direction.x + 
                                        inputData.direction.y * inputData.direction.y);
        
        if (directionLength <= 0) {
            this.handleStopInput();
            return;
        }

        // 根据方向向量的长度计算速度
        const speed = this.maxSpeed * Math.min(directionLength, 1.0); // 限制在最大速度以内
        
        // 归一化方向向量
        const normalizedDirection = new Vec2(
            inputData.direction.x / directionLength,
            inputData.direction.y / directionLength
        );
        
        // 设置速度
        const speed_fp = fromFloat(speed);
        this._velocity.set(fromFloat(normalizedDirection.x), fromFloat(normalizedDirection.y));
        this._velocity.multiplyScalar(speed_fp);
    }

    /**
     * 处理停止输入
     */
    private handleStopInput(): void {
        this._velocity.set(0, 0);
    }

    /**
     * 更新物理状态
     */
    private updatePhysics(fixedDeltaTime_fp: number): void {
        // 物理逻辑被简化，因为速度由输入直接决定
        // 只需根据当前速度更新位置
        const deltaPosition = this._velocity.clone().multiplyScalar(fixedDeltaTime_fp);
        this._position.add(deltaPosition);
        
        this.checkBoundaries();
    }

    /**
     * 边界检测
     */
    private checkBoundaries(): void {
        const screenBounds = {
            left: fromFloat(-GameManager.instance.gameAreaWidth / 2),
            right: fromFloat(GameManager.instance.gameAreaWidth / 2),
            top: fromFloat(GameManager.instance.gameAreaHeight / 2),
            bottom: fromFloat(-GameManager.instance.gameAreaHeight / 2)
        };
        const bounce_fp = fromFloat(-0.8);
        
        if (this._position.x - this._radius_fp < screenBounds.left) {
            this._position.x = screenBounds.left + this._radius_fp;
            this._velocity.x = fMul(this._velocity.x, bounce_fp);
        } else if (this._position.x + this._radius_fp > screenBounds.right) {
            this._position.x = screenBounds.right - this._radius_fp;
            this._velocity.x = fMul(this._velocity.x, bounce_fp);
        }
        
        if (this._position.y + this._radius_fp > screenBounds.top) {
            this._position.y = screenBounds.top - this._radius_fp;
            this._velocity.y = fMul(this._velocity.y, bounce_fp);
        } else if (this._position.y - this._radius_fp < screenBounds.bottom) {
            this._position.y = screenBounds.bottom + this._radius_fp;
            this._velocity.y = fMul(this._velocity.y, bounce_fp);
        }
    }

    /**
     * 更新节点位置 (仅用于初始设置或强制同步)
     */
    private updateNodePosition(): void {
        this.node.setPosition(toFloat(this._renderPosition.x), toFloat(this._renderPosition.y), 0);
    }

    /**
     * 设置小球位置 (接收定点数)
     */
    public setPosition(position: FixedVec2): void {
        this._position.set(position.x, position.y);
        this._previousPosition.set(position.x, position.y);
        this._renderPosition.set(position.x, position.y);
        this.updateNodePosition();
    }

    /**
     * 获取小球位置
     */
    public getPosition(): FixedVec2 {
        return this._position.clone();
    }

    /**
     * 设置小球速度
     */
    public setVelocity(velocity: FixedVec2): void {
        this._velocity.set(velocity.x, velocity.y);
    }

    /**
     * 获取小球速度
     */
    public getVelocity(): FixedVec2 {
        return this._velocity.clone();
    }

    /**
     * 设置小球颜色
     */
    public setColor(color: Color): void {
        this.ballColor = color;
        const sprite = this.node.getComponent(Sprite);
        if (sprite) {
            sprite.color = color;
        }
    }

    /**
     * 设置小球半径
     */
    public setRadius(radius: number): void {
        this.radius = radius;
        this._radius_fp = fromFloat(radius);
        this.updateVisualScale();
    }

    /**
     * 重置小球状态
     */
    public reset(): void {
        this._position.set(0, 0);
        this._velocity.set(0, 0);
        this._renderPosition.set(0, 0);
        this.updateNodePosition();
    }

    /**
     * 检测与另一个球的碰撞
     */
    public checkCollisionWith(otherBall: Ball): boolean {
        if (!this.isAlive || !otherBall.isAlive) {
            return false;
        }
        
        // 计算两球中心距离（使用定点数计算）
        const dx = this._position.x - otherBall._position.x;
        const dy = this._position.y - otherBall._position.y;
        
        // 使用定点数乘法计算距离的平方
        const dxSquared = fMul(dx, dx);
        const dySquared = fMul(dy, dy);
        const distanceSquared = dxSquared + dySquared;
        
        // 计算最小距离的平方（避免开方运算）
        const minDistance = this._radius_fp + otherBall._radius_fp;
        const minDistanceSquared = fMul(minDistance, minDistance);
        
        // 比较距离平方和最小距离平方
        const isColliding = distanceSquared < minDistanceSquared;
        
        return isColliding;
    }

    /**
     * 处理与另一个球的碰撞
     */
    public handleCollisionWith(otherBall: Ball): void {
        if (!this.checkCollisionWith(otherBall)) {
            return;
        }
        
        // 半径大的球吃掉半径小的球
        if (this.radius > otherBall.radius) {
            // 当前球更大，吃掉对方
            this.consumeBall(otherBall);
        } else if (otherBall.radius > this.radius) {
            // 对方球更大，被对方吃掉
            otherBall.consumeBall(this);
        }
        // 半径相等时不做任何处理，球可以穿过
    }

    /**
     * 吃掉另一个球
     */
    private consumeBall(targetBall: Ball): void {
        if (!targetBall.isAlive) {
            return;
        }
        
        // 计算积分（基于被吃球的半径）
        const score = Math.floor(targetBall.radius * 2); // 简单的积分计算
        
        // 增加半径（根据面积增加）
        const myArea = Math.PI * this.radius * this.radius;
        const targetArea = Math.PI * targetBall.radius * targetBall.radius;
        const newArea = myArea + targetArea * 0.8; // 吸收80%的面积
        
        // 计算新半径
        this.radius = Math.sqrt(newArea / Math.PI);
        this._radius_fp = fromFloat(this.radius);
        
        // 更新视觉效果
        this.updateVisualScale();
        
        // 通知GameManager处理积分（包含当前帧ID）
        const currentFrame = GameManager.instance.getCurrentFrame();
        GameManager.instance.onPlayerScore(
            this.playerId, 
            targetBall.playerId, 
            score, 
            currentFrame,
            this.radius,
            targetBall.radius
        );
        
        // 标记目标球为死亡
        targetBall.die();
        
        Logger.log('Ball', `球 ${this.playerId} 吃掉了球 ${targetBall.playerId}，获得积分: ${score}，新半径: ${this.radius.toFixed(2)}`);
    }

    /**
     * 更新视觉缩放
     */
    private updateVisualScale(): void {
        const scale = this.radius * 2 / 100;
        this.node.setScale(scale, scale);
    }

    /**
     * 球死亡处理
     */
    public die(): void {
        this.isAlive = false;
        this.node.active = false;
        
        // 在单人模式下提供额外信息
        if (GameManager.instance.isSinglePlayerMode) {
            const score = GameManager.instance.getPlayerScore(this.playerId);
            Logger.log('Ball', `单人模式：球 ${this.playerId} 被消除，最终积分: ${score}`);
        } else {
            Logger.log('Ball', `球 ${this.playerId} 被消除`);
        }
    }

    /**
     * 复活球（用于重新开始游戏）
     */
    public revive(radius: number = 25): void {
        this.isAlive = true;
        this.node.active = true;
        this.setRadius(radius);
    }
}