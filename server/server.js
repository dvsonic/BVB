const WebSocket = require('ws');
const http = require('http');

/**
 * 简单的WebSocket服务器用于帧同步测试
 */
class FrameSyncServer {
    constructor(port = 8080) {
        this.port = port;
        this.server = null;
        this.wss = null;
        this.rooms = new Map();
        this.clients = new Map();
        this.frameRate = 30;
        this.frameInterval = 1000 / this.frameRate;
        this.gameLoops = new Map();
    }

    start() {
        // 创建HTTP服务器
        this.server = http.createServer();
        
        // 创建WebSocket服务器
        this.wss = new WebSocket.Server({ server: this.server });
        
        // 处理WebSocket连接
        this.wss.on('connection', (ws) => {
            // 为每个客户端生成唯一ID
            const clientId = this.generateClientId();
            this.clients.set(clientId, {
                ws: ws,
                playerId: null,
                roomId: null
            });
            
            // 处理消息
            ws.on('message', (data) => {
                this.handleMessage(clientId, data);
            });
            
            // 处理断开连接
            ws.on('close', () => {
                this.handleDisconnect(clientId);
            });
            
            // 处理错误
            ws.on('error', (error) => {
                console.error('WebSocket错误:', error);
            });
        });
        
        // 启动服务器
        this.server.listen(this.port, () => {
            console.log(`帧同步服务器运行在端口 ${this.port}`);
        });
    }

    generateClientId() {
        return 'client_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    handleMessage(clientId, data) {
        try {
            const message = JSON.parse(data);
            const client = this.clients.get(clientId);
            
            if (!client) {
                return;
            }
            
            switch (message.type) {
                case 'joinRoom':
                    this.handleJoinRoom(clientId, message.data);
                    break;
                case 'leaveRoom':
                    this.handleLeaveRoom(clientId, message.data);
                    break;
                case 'playerInput':
                    this.handlePlayerInput(clientId, message.data);
                    break;
                case 'playerReady':
                    this.handlePlayerReady(clientId, message.data);
                    break;
                // case 'gameStart':
                //     this.handleGameStart(clientId, message.data);
                //     break;
            }
        } catch (error) {
            console.error('处理消息错误:', error);
        }
    }

    handleJoinRoom(clientId, data) {
        const { roomId, playerId } = data;
        const client = this.clients.get(clientId);
        
        if (!client) {
            return;
        }
        
        // 创建房间（如果不存在）
        if (!this.rooms.has(roomId)) {
            this.rooms.set(roomId, {
                id: roomId,
                players: new Map(),
                gameState: 'waiting',
                currentFrame: 0,
                inputBuffer: new Map()
            });
        }
        
        const room = this.rooms.get(roomId);
        
        // 添加玩家到房间
        room.players.set(playerId, {
            playerId: playerId,
            clientId: clientId,
            isReady: false,
            position: { x: 0, y: 0 },
            velocity: { x: 0, y: 0 }
        });
        
        // 更新客户端信息
        client.playerId = playerId;
        client.roomId = roomId;
        
        // 发送房间信息
        this.sendToClient(clientId, {
            type: 'roomInfo',
            data: {
                roomId: roomId,
                players: Array.from(room.players.values()).map(p => ({
                    playerId: p.playerId,
                    isReady: p.isReady
                }))
            }
        });
        
        // 通知房间内其他玩家
        this.broadcastToRoom(roomId, {
            type: 'playerJoined',
            data: { playerId: playerId }
        }, clientId);
        
        console.log(`玩家 ${playerId} 加入房间 ${roomId}`);
    }

    handleLeaveRoom(clientId, data) {
        const client = this.clients.get(clientId);
        
        if (!client || !client.roomId) {
            return;
        }
        
        const room = this.rooms.get(client.roomId);
        if (room) {
            room.players.delete(client.playerId);
            
            // 通知房间内其他玩家
            this.broadcastToRoom(client.roomId, {
                type: 'playerLeft',
                data: { playerId: client.playerId }
            }, clientId);
            
            // 如果房间为空，删除房间
            if (room.players.size === 0) {
                this.rooms.delete(client.roomId);
                this.stopGameLoop(client.roomId);
            }
        }
        
        client.playerId = null;
        client.roomId = null;
    }

    handlePlayerInput(clientId, data) {
        const client = this.clients.get(clientId);
        
        if (!client || !client.roomId) {
            return;
        }
        
        const room = this.rooms.get(client.roomId);
        if (!room) {
            return;
        }
        
        const { frameId, input } = data;
        
        // 将输入添加到缓冲区
        if (!room.inputBuffer.has(frameId)) {
            room.inputBuffer.set(frameId, []);
        }
        
        room.inputBuffer.get(frameId).push(input);
    }

    handlePlayerReady(clientId, data) {
        const client = this.clients.get(clientId);
        
        if (!client || !client.roomId) {
            return;
        }
        
        const room = this.rooms.get(client.roomId);
        if (!room) {
            return;
        }
        
        const player = room.players.get(client.playerId);
        if (player) {
            player.isReady = data.isReady;
            
            // 通知房间内所有玩家
            this.broadcastToRoom(client.roomId, {
                type: 'playerReady',
                data: {
                    playerId: client.playerId,
                    isReady: data.isReady
                }
            });
            
            // 检查是否所有玩家都准备好了
            this.checkAllPlayersReady(client.roomId);
        }
    }

    handleGameStart(clientId, data) {
        const client = this.clients.get(clientId);
        
        if (!client || !client.roomId) {
            return;
        }
        
        this.startGame(client.roomId);
    }

    checkAllPlayersReady(roomId) {
        const room = this.rooms.get(roomId);
        
        if (!room || room.players.size < 1) {
            return;
        }
        
        let allReady = true;
        room.players.forEach(player => {
            if (!player.isReady) {
                allReady = false;
            }
        });
        
        if (allReady) {
            this.startGame(roomId);
        }
    }

    startGame(roomId) {
        const room = this.rooms.get(roomId);
        
        if (!room) {
            return;
        }
        
        room.gameState = 'playing';
        room.currentFrame = 0;
        
        // 通知所有玩家游戏开始，包含当前帧信息
        this.broadcastToRoom(roomId, {
            type: 'gameStart',
            data: {
                timestamp: Date.now(),
                currentFrame: room.currentFrame
            }
        });
        
        // 延迟启动游戏循环，给客户端时间同步
        setTimeout(() => {
            this.startGameLoop(roomId);
        }, 1000); // 延迟1秒
        
        console.log(`房间 ${roomId} 游戏开始`);
    }

    startGameLoop(roomId) {
        const room = this.rooms.get(roomId);
        
        if (!room) {
            return;
        }
        
        const gameLoop = setInterval(() => {
            this.processFrame(roomId);
        }, this.frameInterval);
        
        this.gameLoops.set(roomId, gameLoop);
    }

    stopGameLoop(roomId) {
        const gameLoop = this.gameLoops.get(roomId);
        if (gameLoop) {
            clearInterval(gameLoop);
            this.gameLoops.delete(roomId);
        }
    }

    processFrame(roomId) {
        const room = this.rooms.get(roomId);
        
        if (!room || room.gameState !== 'playing') {
            return;
        }
        
        const currentInputs = room.inputBuffer.get(room.currentFrame) || [];
        
        const frameData = {
            frameId: room.currentFrame,
            inputs: currentInputs,
            timestamp: Date.now()
        };
        
        // 发送帧数据给所有玩家
        this.broadcastToRoom(roomId, {
            type: 'frameData',
            data: frameData
        });
        
        // 清理旧的输入缓冲
        room.inputBuffer.delete(room.currentFrame - 10);
        
        room.currentFrame++;
    }

    handleDisconnect(clientId) {
        const client = this.clients.get(clientId);
        
        if (client && client.roomId) {
            this.handleLeaveRoom(clientId, {});
        }
        
        this.clients.delete(clientId);
    }

    sendToClient(clientId, message) {
        const client = this.clients.get(clientId);
        
        if (client && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify(message));
        }
    }

    broadcastToRoom(roomId, message, excludeClientId = null) {
        const room = this.rooms.get(roomId);
        
        if (!room) {
            return;
        }
        
        room.players.forEach(player => {
            if (player.clientId !== excludeClientId) {
                this.sendToClient(player.clientId, message);
            }
        });
    }

    stop() {
        // 停止所有游戏循环
        this.gameLoops.forEach(gameLoop => {
            clearInterval(gameLoop);
        });
        
        // 关闭所有连接
        this.clients.forEach(client => {
            client.ws.close();
        });
        
        // 关闭服务器
        if (this.server) {
            this.server.close();
        }
        
        console.log('服务器已关闭');
    }
}

// 创建并启动服务器
const server = new FrameSyncServer(8080);
server.start();

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('收到SIGTERM信号，正在关闭服务器...');
    server.stop();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('收到SIGINT信号，正在关闭服务器...');
    server.stop();
    process.exit(0);
});