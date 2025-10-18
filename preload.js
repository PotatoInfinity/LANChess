const { contextBridge, ipcRenderer } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let isStockfishAvailable = false;

try {
    const stockfishPath = path.join(__dirname, 'engine', 'stockfish');
    const testProcess = spawn(stockfishPath, ['uci']); 
    isStockfishAvailable = true;
    console.log('Stockfish executable found and appears to be valid.');
    testProcess.kill();
} catch (error) {
    console.error('Stockfish availability test failed:', error.message);
    isStockfishAvailable = false;
}

function createStockfishInstance() {
    if (!isStockfishAvailable) {
        console.error('Stockfish is not available, cannot create instance.');
        return null;
    }
    
    const stockfishPath = path.join(__dirname, 'engine', 'stockfish');
    const stockfishProcess = spawn(stockfishPath);
    
    let messageHandlers = [];
    let outputBuffer = '';

    stockfishProcess.stdout.on('data', (data) => {
        outputBuffer += data.toString();
        let lines = outputBuffer.split('\n');
        
        if (outputBuffer.slice(-1) !== '\n') {
            outputBuffer = lines.pop();
        } else {
            outputBuffer = ''; 
            if (lines[lines.length -1] === '') lines.pop();
        }
        
        for (const line of lines) {
            if (line.trim()) {
                messageHandlers.forEach(handler => {
                    try {
                        handler(line);
                    } catch (error) {
                        console.error('Error in Stockfish message handler:', error);
                    }
                });
            }
        }
    });
    
    stockfishProcess.stderr.on('data', (data) => {
        console.error('Stockfish stderr:', data.toString());
    });
    
    stockfishProcess.on('close', (code) => {
        console.log(`Stockfish process exited with code: ${code}`);
    });
    
    stockfishProcess.on('error', (error) => {
        console.error('Failed to start Stockfish process:', error);
    });
    
    return {
        postMessage: (command) => {
            if (stockfishProcess && !stockfishProcess.killed) {
                stockfishProcess.stdin.write(command + '\n');
            }
        },
        onmessage: (handler) => {
            if (typeof handler === 'function') {
                messageHandlers.push(handler);
            }
        },
        removeMessageListener: (handlerToRemove) => {
            messageHandlers = messageHandlers.filter(h => h !== handlerToRemove);
        },
        terminate: () => {
            if (stockfishProcess && !stockfishProcess.killed) {
                stockfishProcess.kill();
            }
        }
    };
}

contextBridge.exposeInMainWorld('electronAPI', {
    // LAN Game Functions
    hostGame: () => ipcRenderer.invoke('host-game'),
    setOffer: (offer) => ipcRenderer.send('set-offer', offer),
    onOfferSet: (callback) => ipcRenderer.on('offer-set-success', () => callback()),
    onAnswerReceived: (callback) => ipcRenderer.on('answer-received', (event, answer) => callback(answer)),

    // Stockfish AI Functions
    createStockfish: () => {
        try {
            return createStockfishInstance();
        } catch (error) {
            console.error('Failed to create Stockfish instance via context bridge:', error);
            return null;
        }
    },
    isStockfishAvailable: () => isStockfishAvailable,

    // Puzzle Functions
    getRandomPuzzle: (filters) => ipcRenderer.invoke('get-random-puzzle', filters),
    getPuzzleThemes: () => ipcRenderer.invoke('get-puzzle-themes'),
    
    // Openings Function
    getOpenings: () => ipcRenderer.invoke('get-openings'),
});