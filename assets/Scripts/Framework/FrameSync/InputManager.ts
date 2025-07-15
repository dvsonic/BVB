import { _decorator, Component, Node, director, input, Input, Vec2, Vec3 } from 'cc';
import { FrameSyncManager, PlayerInput, InputType } from './FrameSyncManager';
import { NetworkManager } from '../Network/NetworkManager';
const { ccclass, property } = _decorator;

/**
 * 移动输入数据
 */
export interface MoveInputData {
    direction: Vec2;
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
    private _moveSpeed: number = 200; // 移动速度(已不再使用，保留用于兼容)
    // 删除_currentSpeed，不再需要
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
        this.schedule(this.checkInput, 1/this._frameSyncManager.getFrameRate()); // 30FPS检测
    }

    onDestroy() {
        this.unschedule(this.checkInput);
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
            // 删除速度相关的代码
        }
    }

    public updateControllerState(direction: Vec3, speedRatio: number): void {
        if (!this._isControllerActive) return;
        // 将速度信息编码到方向向量的长度中
        // 这样方向向量的长度就代表了速度的比例
        this._currentInput.set(direction.x * speedRatio, direction.y * speedRatio);
    }

    /**
     * 检查输入变化
     */
    private checkInput(): void {
        // 只处理摇杆输入
        if (this._isControllerActive) {
            this.sendMoveInput(this._currentInput);
            /*if(this._currentInput.y>0) {
                this.sendMoveInput(new Vec2(0, 100));
            }else{
                this.sendMoveInput(new Vec2(0, -100));
            }*/

        }
    }

    /**
     * 发送移动输入
     */
    private sendMoveInput(direction: Vec2): void {
        const inputData: MoveInputData = {
            direction: direction
            // 删除speed字段，速度应该通过direction的长度计算
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
     * 重置输入状态
     */
    public reset(): void {
        this._currentInput.set(0, 0);
        this._isControllerActive = false;
    }
}