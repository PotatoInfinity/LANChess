const electron = require('electron');
const path = require('path');
const express = require('express');
const cors = require('cors');
const ip = require('ip');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const { app, BrowserWindow, ipcMain, session } = electron;

let mainWindow;
const PORT = 8080;

let currentOffer = null;

// --- Puzzle Database Setup ---
const puzzleDBPath = path.join(__dirname, 'assets/puzzle', 'puzzles.db');
let puzzleDB;

function connectToPuzzleDB() {
  if (!fs.existsSync(puzzleDBPath)) {
    console.error('Puzzle database not found at:', puzzleDBPath);
    return;
  }
  puzzleDB = new sqlite3.Database(puzzleDBPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
      console.error('Error connecting to puzzle database:', err.message);
      puzzleDB = null;
    } else {
      console.log('Successfully connected to puzzle database.');
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 950,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);
  // mainWindow.webContents.openDevTools();
}

const startApp = () => {
  const expressApp = express();
  expressApp.use(cors());
  expressApp.use(express.json());
  expressApp.use(express.static(__dirname));

  expressApp.get('/offer', (req, res) => {
    if (currentOffer) res.json({ offer: currentOffer });
    else res.status(404).json({ error: 'Offer not generated yet.' });
  });

  expressApp.post('/answer', (req, res) => {
    const { answer } = req.body;
    if (answer) {
      mainWindow.webContents.send('answer-received', answer);
      res.status(200).json({ message: 'Answer received.' });
    } else {
      res.status(400).json({ error: 'No answer provided.' });
    }
  });

  expressApp.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    createWindow();
  });
};

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    });
  });
  
  connectToPuzzleDB();
  startApp();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (puzzleDB) {
    puzzleDB.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- IPC Handlers ---

ipcMain.handle('host-game', async () => {
  currentOffer = null;
  const serverIp = ip.address();
  return `${serverIp}:${PORT}`;
});

ipcMain.on('set-offer', (event, offer) => {
  currentOffer = offer;
  event.sender.send('offer-set-success');
});

// IPC handler to load the openings file
ipcMain.handle('get-openings', () => {
  try {
    const openingsPath = path.join(__dirname, 'openings.js');
    if (fs.existsSync(openingsPath)) {
      // Use require to load the module. This is efficient as it's cached.
      const openings = require(openingsPath);
      return openings;
    }
    return []; // Return empty if file doesn't exist
  } catch (error) {
    console.error('Failed to load openings file:', error);
    return []; // Return empty on error
  }
});


ipcMain.handle('get-random-puzzle', async (event, filters) => {
  return new Promise((resolve, reject) => {
    if (!puzzleDB) {
      return reject('Puzzle database is not connected.');
    }

    let query = `SELECT * FROM puzzles`;
    const conditions = [];
    const params = [];

    if (filters) {
      if (filters.minRating && filters.maxRating) {
        conditions.push(`Rating BETWEEN ? AND ?`);
        params.push(filters.minRating, filters.maxRating);
      }
      if (filters.themes && filters.themes.length > 0) {
        const themeConditions = filters.themes.map(() => `Themes LIKE ?`).join(' AND ');
        conditions.push(`(${themeConditions})`);
        filters.themes.forEach(theme => params.push(`%${theme}%`));
      }
      if (filters.solvedIds && filters.solvedIds.length > 0) {
        const placeholders = filters.solvedIds.map(() => '?').join(',');
        conditions.push(`PuzzleId NOT IN (${placeholders})`);
        params.push(...filters.solvedIds);
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ` ORDER BY RANDOM() LIMIT 1;`;
    
    puzzleDB.get(query, params, (err, row) => {
      if (err) {
        return reject(err.message);
      }
      resolve(row);
    });
  });
});

ipcMain.handle('get-puzzle-themes', async () => {
    return new Promise((resolve, reject) => {
        if (!puzzleDB) {
            return reject('Puzzle database is not connected.');
        }
        const query = `SELECT Themes FROM puzzles;`;
        puzzleDB.all(query, [], (err, rows) => {
            if (err) {
                return reject(err.message);
            }
            const allThemes = new Set();
            rows.forEach(row => {
                row.Themes.split(' ').forEach(theme => {
                    if(theme) allThemes.add(theme);
                });
            });
            resolve(Array.from(allThemes).sort());
        });
    });
});