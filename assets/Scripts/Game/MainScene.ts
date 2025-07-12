import { _decorator, Component, Node, Button, Label, Canvas, UITransform, Color, director, Prefab, instantiate } from 'cc';
import { GameManager, GameState } from './GameManager';
import { NetworkManager, MessageType } from '../Framework/Network/NetworkManager';
import { FrameSyncManager } from '../Framework/FrameSync/FrameSyncManager';
import { InputManager } from '../Framework/FrameSync/InputManager';
const { ccclass, property } = _decorator;

/**
 * 主场景控制器
 */
@ccclass('MainScene')
export class MainScene extends Component {
    @property(Node)
    public uiContainer: Node = null;
    
    @property(Button)
    public createOrJoin: Button = null;
    
    @property(Button)
    public startButton: Button = null;
    
    @property(Button)
    public pauseButton: Button = null;
    
    @property(Label)
    public statusLabel: Label = null;
    
    @property(Label)
    public playerCountLabel: Label = null;
    
    @property(Label)
    public frameLabel: Label = null;
    
    @property(Node)
    public gameArea: Node = null;
    
    @property(Prefab)
    public ballPrefab: Prefab = null;
    
    private _gameManager: GameManager = null;
    private _networkManager: NetworkManager = null;
    private _frameSyncManager: FrameSyncManager = null;
    private _inputManager: InputManager = null;
    private _isUISetup: boolean = false;

    onLoad() {
        this.init();
    }

    private init(): void {
        // 获取管理器实例
        this._networkManager = NetworkManager.instance;
        this._frameSyncManager = FrameSyncManager.instance;
        this._inputManager = InputManager.instance;
        this._gameManager = GameManager.instance;
        
        // 设置UI
        this.setupUI();

        
        GameManager.instance.init();
        GameManager.instance.setBallPrefab(this.ballPrefab);
        GameManager.instance.setGameArea(this.gameArea);
        
        // 开始状态更新
        this.schedule(this.updateUI, 0.1); // 每100ms更新一次UI
        
        console.log('主场景初始化完成');
    }

    private setupUI(): void {
        if (this._isUISetup) {
            return;
        }
        
        // 创建UI容器
        if (!this.uiContainer) {
            this.uiContainer = new Node('UIContainer');
            this.node.addChild(this.uiContainer);
        }
        
        // 创建开始按钮
        this.createStartButton();
        
        // 创建准备按钮 (现在是开始按钮)
        this.createReadyButton();
        
        // 创建暂停按钮
        this.createPauseButton();
        
        // 创建状态标签
        this.createStatusLabel();
        
        // 创建玩家数量标签
        this.createPlayerCountLabel();
        
        // 创建帧数标签
        this.createFrameLabel();
        
        // 创建游戏区域
        this.createGameArea();
        
        this._isUISetup = true;
    }

    private createStartButton(): void { // 这个现在是 createOrJoin 按钮
        if (!this.createOrJoin) {
            const buttonNode = new Node('CreateOrJoinButton');
            this.uiContainer.addChild(buttonNode);
            
            const button = buttonNode.addComponent(Button);
            const uiTransform = buttonNode.getComponent(UITransform);
            
            uiTransform.setContentSize(120, 40);
            buttonNode.setPosition(0, 200, 0);
            
            this.createOrJoin = button;
        }
        this.createOrJoin.node.on(Button.EventType.CLICK, this.onCreateOrJoinClick, this);
    }

    private createReadyButton(): void { // 这个现在是 startButton 按钮
        if (!this.startButton) {
            const buttonNode = new Node('StartButton');
            this.uiContainer.addChild(buttonNode);
            
            const button = buttonNode.addComponent(Button);
            const uiTransform = buttonNode.getComponent(UITransform);
            
            uiTransform.setContentSize(120, 40);
            buttonNode.setPosition(0, 150, 0);
            
            this.startButton = button;
        }
        this.startButton.node.on(Button.EventType.CLICK, this.onStartButtonClick, this);
        this.startButton.node.active = false; // 默认隐藏
    }

    private createPauseButton(): void {
        if (!this.pauseButton) {
            const buttonNode = new Node('PauseButton');
            this.uiContainer.addChild(buttonNode);
            
            const button = buttonNode.addComponent(Button);
            const uiTransform = buttonNode.getComponent(UITransform);
            
            uiTransform.setContentSize(120, 40);
            buttonNode.setPosition(0, 100, 0);
            
            this.pauseButton = button;
        }
        
        this.pauseButton.node.on(Button.EventType.CLICK, this.onPauseButtonClick, this);
        this.pauseButton.node.active = false; // 默认隐藏
    }

    private createStatusLabel(): void {
        if (!this.statusLabel) {
            const labelNode = new Node('StatusLabel');
            this.uiContainer.addChild(labelNode);
            
            const label = labelNode.addComponent(Label);
            const uiTransform = labelNode.getComponent(UITransform);
            
            uiTransform.setContentSize(300, 30);
            labelNode.setPosition(0, 250, 0);
            
            label.string = '等待开始...';
            label.fontSize = 24;
            label.color = Color.WHITE;
            
            this.statusLabel = label;
        }
    }

    private createPlayerCountLabel(): void {
        if (!this.playerCountLabel) {
            const labelNode = new Node('PlayerCountLabel');
            this.uiContainer.addChild(labelNode);
            
            const label = labelNode.addComponent(Label);
            const uiTransform = labelNode.getComponent(UITransform);
            
            uiTransform.setContentSize(200, 30);
            labelNode.setPosition(-300, 250, 0);
            
            label.string = '玩家数量: 0';
            label.fontSize = 20;
            label.color = Color.WHITE;
            
            this.playerCountLabel = label;
        }
    }

    private createFrameLabel(): void {
        if (!this.frameLabel) {
            const labelNode = new Node('FrameLabel');
            this.uiContainer.addChild(labelNode);
            
            const label = labelNode.addComponent(Label);
            const uiTransform = labelNode.getComponent(UITransform);
            
            uiTransform.setContentSize(200, 30);
            labelNode.setPosition(300, 250, 0);
            
            label.string = '帧数: 0';
            label.fontSize = 20;
            label.color = Color.WHITE;
            
            this.frameLabel = label;
        }
    }

    private createGameArea(): void {
        if (!this.gameArea) {
            this.gameArea = new Node('GameArea');
            this.node.addChild(this.gameArea);
            
            const uiTransform = this.gameArea.addComponent(UITransform);
            uiTransform.setContentSize(800, 600);
            
            this.gameArea.setPosition(0, -50, 0);
        }
    }

    private updateUI(): void {
        if (!this._gameManager) {
            return;
        }
        
        // 更新状态标签
        this.updateStatusLabel();
        
        // 更新玩家数量标签
        this.updatePlayerCountLabel();
        
        // 更新帧数标签
        this.updateFrameLabel();
        
        // 更新按钮状态
        this.updateButtonStates();
    }

    private updateStatusLabel(): void {
        if (!this.statusLabel) return;
        
        const gameState = this._gameManager.gameState;
        let statusText = '';
        
        switch (gameState) {
            case GameState.WAITING:
                statusText = '等待玩家加入...';
                break;
            case GameState.PLAYING:
                statusText = '游戏进行中';
                break;
            case GameState.PAUSED:
                statusText = '游戏已暂停';
                break;
            case GameState.FINISHED:
                statusText = '游戏已结束';
                break;
        }
        
        this.statusLabel.string = statusText;
    }

    private updatePlayerCountLabel(): void {
        if (!this.playerCountLabel) return;
        
        const playerCount = this._gameManager.playerCount;
        this.playerCountLabel.string = `玩家数量: ${playerCount}`;
    }

    private updateFrameLabel(): void {
        if (!this.frameLabel) return;
        
        const currentFrame = this._frameSyncManager.currentFrame;
        this.frameLabel.string = `帧数: ${currentFrame}`;
    }

    private updateButtonStates(): void {
        if (!this._gameManager || !this._isUISetup) {
            return;
        }

        const myPlayerId = this._networkManager.playerId;
        const isInRoom = this._gameManager.roomId !== '';
        const isOwner = myPlayerId === this._gameManager.ownerId && isInRoom;
        const gameState = this._gameManager.gameState;

        // "创建/加入房间" 按钮的逻辑
        // 游戏处于等待状态，且玩家还未加入任何房间时显示
        this.createOrJoin.node.active = gameState === GameState.WAITING && !isInRoom;

        // "开始游戏" 按钮的逻辑 (原为 readyButton)
        // 只有房主能看到，并且游戏处于等待状态
        this.startButton.node.active = isOwner && gameState === GameState.WAITING;
        
        // "暂停" 按钮的逻辑
        // 游戏进行中时显示
        this.pauseButton.node.active = gameState === GameState.PLAYING;
    }

    private onCreateOrJoinClick(): void {
        console.log('创建/加入房间按钮点击');
        if (!this._networkManager.isConnected) {
            this._networkManager.connect()
                .then(() => {
                    this._networkManager.findAndJoinRoom();
                })
                .catch(err => {
                    console.error('连接服务器失败:', err);
                });
        } else {
            this._networkManager.findAndJoinRoom();
        }
    }

    private onStartButtonClick(): void {
        console.log('房主点击了开始按钮');
        // 由于按钮的显示/隐藏逻辑已经确保了点击者是房主，
        // 这里可以直接发送开始游戏的指令。
        this._networkManager.sendMessage({
            type: MessageType.GAME_START,
            data: {}
        });
    }

    private onPauseButtonClick(): void {
        const gameState = this._gameManager.gameState;
        if (gameState === GameState.PLAYING) {
            this._gameManager.pauseGame();
        } else if (gameState === GameState.PAUSED) {
            this._gameManager.resumeGame();
        }
    }

    onDestroy() {
        // 清理事件监听
        if (this.createOrJoin) {
            this.createOrJoin.node.off(Button.EventType.CLICK, this.onCreateOrJoinClick, this);
        }
        if (this.startButton) {
            this.startButton.node.off(Button.EventType.CLICK, this.onStartButtonClick, this);
        }
        if (this.pauseButton) {
            this.pauseButton.node.off(Button.EventType.CLICK, this.onPauseButtonClick, this);
        }
        
        this.unschedule(this.updateUI);
    }
}