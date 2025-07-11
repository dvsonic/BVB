import { _decorator, Component, Node, director } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 网络消息类型
 */
export enum MessageType {
    JOIN_ROOM = 'joinRoom',
    LEAVE_ROOM = 'leaveRoom',
    FRAME_DATA = 'frameData',
    PLAYER_INPUT = 'playerInput',
    GAME_STATE = 'gameState',
    ROOM_INFO = 'roomInfo',
    PLAYER_READY = 'playerReady',
    GAME_START = 'gameStart'
}

/**
 * 网络消息接口
 */
export interface NetworkMessage {
    type: MessageType;
    data: any;
    timestamp?: number;
    playerId?: string;
}

/**
 * 网络管理器
 */
@ccclass('NetworkManager')
export class NetworkManager extends Component {
    private static _instance: NetworkManager = null;
    private _socket: WebSocket = null;
    private _isConnected: boolean = false;
    private _messageHandlers: Map<MessageType, Function[]> = new Map();
    private _playerId: string = '';
    private _roomId: string = '';
    
    public static get instance(): NetworkManager {
        if (!NetworkManager._instance) {
            const node = new Node('NetworkManager');
            NetworkManager._instance = node.addComponent(NetworkManager);
            director.addPersistRootNode(node);
        }
        return NetworkManager._instance;
    }

    onLoad() {
        if (NetworkManager._instance && NetworkManager._instance !== this) {
            this.node.destroy();
            return;
        }
        NetworkManager._instance = this;
        this.generatePlayerId();
    }

    /**
     * 连接到服务器
     */
    public connect(serverUrl: string = 'ws://localhost:8080'): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this._socket && this._socket.readyState === WebSocket.OPEN) {
                resolve();
                return;
            }

            this._socket = new WebSocket(serverUrl);
            
            this._socket.onopen = () => {
                console.log('WebSocket连接成功');
                this._isConnected = true;
                resolve();
            };

            this._socket.onmessage = (event) => {
                this.handleMessage(event.data);
            };

            this._socket.onclose = () => {
                console.log('WebSocket连接关闭');
                this._isConnected = false;
            };

            this._socket.onerror = (error) => {
                console.error('WebSocket错误:', error);
                this._isConnected = false;
                reject(error);
            };
        });
    }

    /**
     * 断开连接
     */
    public disconnect(): void {
        if (this._socket) {
            this._socket.close();
            this._socket = null;
        }
        this._isConnected = false;
    }

    /**
     * 发送消息
     */
    public sendMessage(message: NetworkMessage): void {
        if (!this._isConnected || !this._socket) {
            console.warn('WebSocket未连接，无法发送消息');
            return;
        }

        message.timestamp = Date.now();
        message.playerId = this._playerId;
        
        this._socket.send(JSON.stringify(message));
    }

    /**
     * 处理接收到的消息
     */
    private handleMessage(data: string): void {
        try {
            const message: NetworkMessage = JSON.parse(data);
            const handlers = this._messageHandlers.get(message.type);
            
            if (handlers) {
                handlers.forEach(handler => handler(message));
            }
        } catch (error) {
            console.error('解析消息失败:', error);
        }
    }

    /**
     * 注册消息处理器
     */
    public registerMessageHandler(type: MessageType, handler: Function): void {
        if (!this._messageHandlers.has(type)) {
            this._messageHandlers.set(type, []);
        }
        this._messageHandlers.get(type).push(handler);
    }

    /**
     * 取消注册消息处理器
     */
    public unregisterMessageHandler(type: MessageType, handler: Function): void {
        const handlers = this._messageHandlers.get(type);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    /**
     * 加入房间
     */
    public joinRoom(roomId: string): void {
        this._roomId = roomId;
        this.sendMessage({
            type: MessageType.JOIN_ROOM,
            data: { roomId, playerId: this._playerId }
        });
    }

    /**
     * 离开房间
     */
    public leaveRoom(): void {
        if (this._roomId) {
            this.sendMessage({
                type: MessageType.LEAVE_ROOM,
                data: { roomId: this._roomId, playerId: this._playerId }
            });
            this._roomId = '';
        }
    }

    /**
     * 发送输入数据
     */
    public sendInput(frameId: number, input: any): void {
        this.sendMessage({
            type: MessageType.PLAYER_INPUT,
            data: {
                frameId: frameId,
                input: input
            }
        });
    }

    /**
     * 生成唯一玩家ID
     */
    private generatePlayerId(): void {
        this._playerId = 'player_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    /**
     * 获取玩家ID
     */
    public get playerId(): string {
        return this._playerId;
    }

    /**
     * 获取房间ID
     */
    public get roomId(): string {
        return this._roomId;
    }

    /**
     * 获取连接状态
     */
    public get isConnected(): boolean {
        return this._isConnected;
    }
}