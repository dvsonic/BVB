import { _decorator, Component, Node, Vec2, Vec3, Color, Sprite } from 'cc';
import { FrameData, PlayerInput, InputType } from '../Framework/FrameSync/FrameSyncManager';
import { MoveInputData } from '../Framework/FrameSync/InputManager';
import { FixedVec2, fromFloat, toFloat, fMul, fDiv } from '../Framework/FrameSync/FixedPoint';

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
    
    private _radius_fp: number = 0;
    
    // --- 使用定点数进行物理计算 ---
    private _position: FixedVec2 = new FixedVec2();
    private _velocity: FixedVec2 = new FixedVec2();

    // --- 用于渲染插值 ---
    private _previousPosition: FixedVec2 = new FixedVec2();
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
    }

    /**
     * 渲染更新 (每渲染帧调用)
     * @param deltaTime 
     */
    update(deltaTime: number): void {
        this._timeSinceLastLogicUpdate += deltaTime;
        
        const alpha = Math.min(this._timeSinceLastLogicUpdate / this._logicFrameInterval, 1.0);

        // --- 插值计算 ---
        const prevX = toFloat(this._previousPosition.x);
        const prevY = toFloat(this._previousPosition.y);
        const currentX = toFloat(this._position.x);
        const currentY = toFloat(this._position.y);

        const renderX = prevX + (currentX - prevX) * alpha;
        const renderY = prevY + (currentY - prevY) * alpha;
        
        this.node.setPosition(renderX, renderY);
    }

    /**
     * 处理帧数据 (每逻辑帧调用)
     */
    public processFrameData(frameData: FrameData, fixedDeltaTime: number): void {
        this._previousPosition.set(this._position.x, this._position.y);
        this._logicFrameInterval = fixedDeltaTime;
        const fixedDeltaTime_fp = fromFloat(fixedDeltaTime);

        const playerInput = frameData.inputs.find(input => input.playerId === this.playerId);
        
        if (playerInput) {
            this.processPlayerInput(playerInput);
        }
        
        this.updatePhysics(fixedDeltaTime_fp);

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

        if (inputData.speed <= 0) {
            this.handleStopInput();
            return;
        }

        // 输入的 direction 已经归一化，speed是目标速度
        // 直接根据输入设置速度
        const speed_fp = fromFloat(inputData.speed);
        this._velocity.set(fromFloat(inputData.direction.x), fromFloat(inputData.direction.y));
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
            left: fromFloat(-400),
            right: fromFloat(400),
            top: fromFloat(300),
            bottom: fromFloat(-300)
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
        this.node.setPosition(toFloat(this._position.x), toFloat(this._position.y), 0);
    }

    /**
     * 设置小球位置 (接收定点数)
     */
    public setPosition(position: FixedVec2): void {
        this._position.set(position.x, position.y);
        this._previousPosition.set(position.x, position.y);
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
     * 重置小球状态
     */
    public reset(): void {
        this._position.set(0, 0);
        this._velocity.set(0, 0);
        this.updateNodePosition();
    }
}