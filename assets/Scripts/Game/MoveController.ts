import { _decorator, Component, Node, Vec3, EventTouch, input, Input, UITransform, v3 } from 'cc';
import { InputManager } from '../Framework/FrameSync/InputManager';
const { ccclass, property } = _decorator;

@ccclass('MoveController')
export class MoveController extends Component {

    private anchor: Node = null;
    private bg: Node = null;

    private radius: number = 0;

    public dir: Vec3 = v3();
    public speed: number = 0;

    private _isTouching: boolean = false;
    private _inputManager: InputManager = null;

    onLoad() {
        this.anchor = this.node.getChildByName('Anchor');
        this.bg = this.node.getChildByName('BG');

        if (this.bg) {
            const transform = this.bg.getComponent(UITransform);
            this.radius = transform.width / 2;
        }
        this._inputManager = InputManager.instance;
    }

    start() {
        this.node.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        // 移除了在 this.anchor 上的重复监听。
        // 因为 anchor 是 node 的子节点，所有在 anchor 上的触摸事件
        // 都会冒泡到 node 上，所以只需要在 node 上监听一次即可。
        // this.anchor.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        // this.anchor.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        // this.anchor.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        // this.anchor.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);

        if (this.anchor) {
            this.anchor.setPosition(Vec3.ZERO);
        }

        this._inputManager.registerMoveController(this);
    }

    onDestroy() {
        this.node.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        // 由于我们移除了 anchor 上的监听，这里也无需再添加 off
        if (this._inputManager) {
            if (this._isTouching) {
                this._inputManager.stopController();
            }
            this._inputManager.unregisterMoveController();
        }
    }

    private onTouchStart(event: EventTouch) {
        this._isTouching = true;
        this._inputManager.startController();
        this.onTouchMove(event);
    }

    private onTouchMove(event: EventTouch) {
        if (!this.anchor || !this.bg || !this._isTouching) {
            return;
        }

        const location = event.getUILocation();
        const transform = this.node.getComponent(UITransform);
        const localPos = transform.convertToNodeSpaceAR(v3(location.x, location.y, 0));

        const len = localPos.length();

        if (len > this.radius) {
            localPos.multiplyScalar(this.radius / len);
        }

        this.anchor.setPosition(localPos);

        this.dir.set(localPos).normalize();
        this.speed = Math.min(len / this.radius, 1.0);
    }

    private onTouchEnd(event: EventTouch) {
        if (!this._isTouching) return;
        this._isTouching = false;
        
        this._inputManager.stopController();

        if (this.anchor) {
            this.anchor.setPosition(Vec3.ZERO);
        }

        this.speed = 0;
        this.dir.set(Vec3.ZERO);
    }

    update(deltaTime: number) {
        if (this._isTouching) {
            this._inputManager.updateControllerState(this.dir, this.speed);
        }
    }
}


