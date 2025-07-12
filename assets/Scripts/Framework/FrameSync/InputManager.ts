import { _decorator, Component, Node, director, input, Input, Vec2, Vec3 } from 'cc';
import { FrameSyncManager, PlayerInput, InputType } from './FrameSyncManager';
import { NetworkManager } from '../Network/NetworkManager';
import { MoveController } from '../../Game/MoveController';
const { ccclass, property } = _decorator;

/**
 * 移动输入数据
 */
export interface MoveInputData {
    direction: Vec2;
    speed: number;
}

/**
 * 输入管理器
 */
@ccclass('InputManager')
export class InputManager extends Component {
    private static _instance: InputManager = null;
    
    private _frameSyncManager: FrameSyncManager = null;
    private _networkManager: NetworkManager = null;
    private _currentInput: Vec2 = new Vec2(0, 0);
    private _lastInputTime: number = 0;
    private _inputThreshold: number = 16; // 输入间隔阈值（毫秒）- 改为16ms约等于60FPS
    private _moveSpeed: number = 200; // 移动速度
    private _moveController: MoveController = null;
    private _currentSpeed: number = 0; // 来自控制器的速度
    private _isControllerActive: boolean = false;

    public static get instance(): InputManager {
        if (!InputManager._instance) {
            const node = new Node('InputManager');
            InputManager._instance = node.addComponent(InputManager);
            director.addPersistRootNode(node);
        }
        return InputManager._instance;
    }

    onLoad() {
        if (InputManager._instance && InputManager._instance !== this) {
            this.node.destroy();
            return;
        }
        InputManager._instance = this;
        this.init();
    }

    private init(): void {
        this._frameSyncManager = FrameSyncManager.instance;
        this._networkManager = NetworkManager.instance;
        
        // 开始输入检测循环
        this.schedule(this.checkInput, 1/60); // 60FPS检测
    }

    onDestroy() {
        this.unschedule(this.checkInput);
    }

    /**
     * 注册移动控制器
     */
    public registerMoveController(controller: MoveController): void {
        this._moveController = controller;
        this.reset();
    }

    /**
     * 注销移动控制器
     */
    public unregisterMoveController(): void {
        this._moveController = null;
        this.reset();
    }
    
    public startController(): void {
        this._isControllerActive = true;
    }

    public stopController(): void {
        if (this._isControllerActive) {
            this._isControllerActive = false;
            this.sendStopInput();
            
            // 关键：必须在停止时重置共享的输入状态
            this._currentInput.set(0, 0);
            this._currentSpeed = 0;
        }
    }

    public updateControllerState(direction: Vec3, speedRatio: number): void {
        if (!this._isControllerActive) return;
        this._currentInput.set(direction.x, direction.y);
        this._currentSpeed = this._moveSpeed * speedRatio;
    }

    /**
     * 检查输入变化
     */
    private checkInput(): void {
        const now = Date.now();
        if (now - this._lastInputTime < this._inputThreshold) {
            return;
        }

        // 只处理摇杆输入
        if (this._isControllerActive) {
            this.sendMoveInput(this._currentInput, this._currentSpeed);
        }

        this._lastInputTime = now;
    }

    /**
     * 发送移动输入
     */
    private sendMoveInput(direction: Vec2, speed?: number): void {
        const inputData: MoveInputData = {
            direction: direction,
            speed: speed ?? this._moveSpeed
        };
        
        const playerInput: PlayerInput = {
            playerId: this._networkManager.playerId,
            inputType: InputType.MOVE,
            inputData: inputData,
            timestamp: Date.now()
        };
        
        this._frameSyncManager.addInput(playerInput);
    }

    /**
     * 发送停止输入
     */
    private sendStopInput(): void {
        const playerInput: PlayerInput = {
            playerId: this._networkManager.playerId,
            inputType: InputType.STOP,
            inputData: null,
            timestamp: Date.now()
        };
        
        this._frameSyncManager.addInput(playerInput);
    }

    /**
     * 获取当前输入
     */
    public getCurrentInput(): Vec2 {
        return this._currentInput.clone();
    }

    /**
     * 设置移动速度
     */
    public setMoveSpeed(speed: number): void {
        this._moveSpeed = speed;
    }

    /**
     * 获取移动速度
     */
    public getMoveSpeed(): number {
        return this._moveSpeed;
    }

    /**
     * 设置输入阈值
     */
    public setInputThreshold(threshold: number): void {
        this._inputThreshold = threshold;
    }

    /**
     * 重置输入状态
     */
    public reset(): void {
        this._currentInput.set(0, 0);
        this._lastInputTime = 0;
        this._currentSpeed = 0;
        this._isControllerActive = false;
    }
}