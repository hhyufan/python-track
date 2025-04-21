import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import path, { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { spawn } from 'child_process'
import fs from 'fs'
import stateStore from './store'
// 存储Python进程引用
let pythonProcess = null
// 存储待处理的IPC请求
let pendingRequests = new Map()

// 启动Python IPC服务器
function startPythonIpcServer() {
  // 确定Python脚本路径
  let scriptPath
  let pythonCommand

  if (is.dev) {
    // 开发环境使用源代码
    scriptPath = path.join(__dirname, '../../python-server/ipc_server.py')
    pythonCommand = 'python'
  } else {
    // 生产环境使用打包后的可执行文件
    // 首先尝试在resources目录下查找
    scriptPath = path.join(process.resourcesPath, 'python_ipc_server.exe')

    // 如果不存在，则尝试在python-server目录下查找
    if (!fs.existsSync(scriptPath)) {
      scriptPath = path.join(
        process.resourcesPath,
        'python-server',
        'dist',
        'python_ipc_server.exe'
      )
    }

    pythonCommand = scriptPath
  }

  // 检查文件是否存在
  if (!fs.existsSync(scriptPath)) {
    console.error(`Python IPC服务器文件不存在: ${scriptPath}`)
    return null
  }

  // 启动Python进程
  const options = is.dev ? [scriptPath] : []
  pythonProcess = spawn(pythonCommand, options, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  })

  // 设置编码
  pythonProcess.stdin.setDefaultEncoding('utf8')
  pythonProcess.stdout.setEncoding('utf8')
  pythonProcess.stderr.setEncoding('utf8')

  // 存储流式传输的数据
  const streamBuffers = new Map()

  // 处理Python进程的标准输出
  let dataBuffer = '' // 用于存储不完整的JSON数据
  pythonProcess.stdout.on('data', (data) => {
    try {
      // 将新数据添加到缓冲区
      dataBuffer += data.toString()

      // 尝试从缓冲区中提取完整的JSON对象
      let startIndex = 0
      let endIndex

      // 循环处理缓冲区中的所有完整JSON对象
      while ((endIndex = findJsonEnd(dataBuffer, startIndex)) !== -1) {
        const jsonStr = dataBuffer.substring(startIndex, endIndex + 1)
        startIndex = endIndex + 1

        try {
          const response = JSON.parse(jsonStr)
          console.log('Python响应类型:', response.status)

          // 处理流式传输
          if (response.status === 'stream_start') {
            // 初始化流缓冲区
            streamBuffers.set(response.requestId, {
              chunks: new Array(response['total_chunks']).fill(''),
              total: response['total_chunks'],
              received: 0,
              completed: false // 添加标志表示是否已完成
            })
          } else if (response.status === 'stream_chunk') {
            // 存储数据块
            const buffer = streamBuffers.get(response.requestId)
            if (buffer && !buffer.completed) {
              buffer.chunks[response['chunk_index']] = response['chunk_data']
              buffer.received++

              // 检查是否所有块都已接收
              if (buffer.received === buffer.total) {
                processCompleteStream(response.requestId, buffer)
              }
            }
          } else if (response.status === 'stream_end') {
            // 标记流传输结束
            const buffer = streamBuffers.get(response.requestId)
            if (buffer && !buffer.completed && buffer.received === buffer.total) {
              processCompleteStream(response.requestId, buffer)
            }
          } else if (response.status && pendingRequests.has(response.requestId)) {
            // 处理常规响应（非流式）
            const { resolve, reject } = pendingRequests.get(response.requestId)
            pendingRequests.delete(response.requestId)

            if (response.status === 'error') {
              reject(new Error(response.message))
            } else {
              resolve(response)
            }
          }
        } catch (jsonError) {
          console.error('解析JSON时出错:', jsonError, '\n原始数据:', jsonStr)
        }
      }

      // 保留未处理的数据部分
      if (startIndex > 0) {
        dataBuffer = dataBuffer.substring(startIndex)
      }

      // 如果缓冲区过大，可能是因为接收了不完整的数据，进行清理
      if (dataBuffer.length > 1000000) {
        // 1MB限制
        console.warn('数据缓冲区过大，清理中...')
        dataBuffer = dataBuffer.substring(dataBuffer.length - 100000) // 保留最后100KB
      }
    } catch (error) {
      console.error('处理Python响应时出错:', error)
    }
  })

  // 辅助函数：查找JSON对象的结束位置
  function findJsonEnd(str, startPos) {
    try {
      // 找到可能的JSON开始位置
      let pos = str.indexOf('{', startPos)
      if (pos === -1) return -1

      let openBraces = 0
      let inString = false
      let escaped = false

      for (let i = pos; i < str.length; i++) {
        const char = str[i]

        if (inString) {
          if (escaped) {
            escaped = false
          } else if (char === '\\') {
            escaped = true
          } else if (char === '"') {
            inString = false
          }
        } else if (char === '"') {
          inString = true
        } else if (char === '{') {
          openBraces++
        } else if (char === '}') {
          openBraces--
          if (openBraces === 0) {
            return i // 找到JSON结束位置
          }
        }
      }

      return -1 // 未找到完整的JSON
    } catch (e) {
      console.error('查找JSON结束位置时出错:', e)
      return -1
    }
  }

  // 辅助函数：处理完整的流数据
  function processCompleteStream(requestId, buffer) {
    try {
      // 标记为已完成，防止重复处理
      buffer.completed = true

      // 重组完整数据
      const fullJson = buffer.chunks.join('')
      try {
        const fullResponse = JSON.parse(fullJson)
        console.log('流式传输完成，重组数据成功')

        // 处理重组后的响应
        if (pendingRequests.has(requestId)) {
          const { resolve, reject } = pendingRequests.get(requestId)
          pendingRequests.delete(requestId)

          if (fullResponse.status === 'error') {
            reject(new Error(fullResponse.message))
          } else {
            resolve(fullResponse)
          }
        }
      } catch (parseError) {
        console.error('解析重组数据时出错:', parseError)
        if (pendingRequests.has(requestId)) {
          const { reject } = pendingRequests.get(requestId)
          pendingRequests.delete(requestId)
          reject(new Error('解析流式数据失败'))
        }
      }

      // 清理缓冲区
      streamBuffers.delete(requestId)
    } catch (e) {
      console.error('处理完整流数据时出错:', e)
    }
  }

  // 处理Python进程的标准错误
  pythonProcess.stderr.on('data', (data) => {
    console.error('Python错误:', data.toString())
  })

  // 处理Python进程关闭
  pythonProcess.on('close', (code) => {
    console.log(`Python进程已关闭，退出码: ${code}`)
    pythonProcess = null

    // 拒绝所有待处理的请求
    for (const [id, { reject }] of pendingRequests.entries()) {
      reject(new Error('Python进程已关闭'))
      pendingRequests.delete(id)
    }
  })

  return pythonProcess
}

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    frame: false, // 移除默认窗口标题栏
    ...(process.platform === 'linux' ? { icon } : {}),
    title: 'Python代码跟练系统',
    icon: icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  // 启动Python IPC服务器
  pythonProcess = startPythonIpcServer()
  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 添加窗口关闭前的事件处理
  mainWindow.on('close', () => {
    // 确保Python进程在窗口关闭前被终止
    if (pythonProcess && !pythonProcess.killed) {
      try {
        // 在Windows上使用taskkill强制终止进程及其子进程
        if (process.platform === 'win32' && pythonProcess.pid) {
          const { execSync } = require('child_process')
          try {
            // 确保使用/t参数终止所有子进程
            execSync(`taskkill /pid ${pythonProcess.pid} /f /t`)
            console.log(`窗口关闭前已强制终止Python进程及其子进程(PID: ${pythonProcess.pid})`)

            // 等待一小段时间确保进程完全终止
            setTimeout(() => {
              // 检查进程是否仍然存在
              try {
                execSync(`tasklist /fi "pid eq ${pythonProcess.pid}" /fo csv /nh`)
                console.warn(
                  `窗口关闭前Python进程(PID: ${pythonProcess.pid})可能仍在运行，尝试再次终止`
                )
                execSync(`taskkill /pid ${pythonProcess.pid} /f /t`)
              } catch (checkError) {
                // 如果tasklist命令失败，说明进程已经不存在
                console.log(`窗口关闭前确认Python进程(PID: ${pythonProcess.pid})已终止`, checkError)
              }
            }, 500)
          } catch (e) {
            console.error('窗口关闭前使用taskkill终止进程失败:', e)
          }
        }

        // 常规终止方式作为备选
        pythonProcess.kill('SIGKILL')
        pythonProcess = null
      } catch (error) {
        console.error('窗口关闭前终止Python进程时出错:', error)
      }
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')
  app.commandLine.appendSwitch('disable-site-isolation-trials')
  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 处理窗口控制
  ipcMain.on('window-control', (event, command) => {
    const window = BrowserWindow.getFocusedWindow()
    if (window) {
      switch (command) {
        case 'minimize':
          window.minimize()
          break
        case 'maximize':
          if (window.isMaximized()) {
            window.unmaximize()
          } else {
            window.maximize()
          }
          break
        case 'close':
          // 先终止Python进程，再关闭窗口
          if (pythonProcess && !pythonProcess.killed) {
            try {
              // 在Windows上使用taskkill强制终止进程及其子进程
              if (process.platform === 'win32' && pythonProcess.pid) {
                const { execSync } = require('child_process')
                try {
                  // 确保使用/t参数终止所有子进程
                  execSync(`taskkill /pid ${pythonProcess.pid} /f /t`)
                  console.log(`已强制终止Python进程及其子进程(PID: ${pythonProcess.pid})`)
                } catch (e) {
                  console.error('使用taskkill终止进程失败:', e)
                }
              }

              // 常规终止方式作为备选
              pythonProcess.kill('SIGKILL')
              pythonProcess = null
            } catch (error) {
              console.error('终止Python进程时出错:', error)
            }
          }
          window.close()
          break
      }
    }
  })

  // 保存Python代码到本地文件
  ipcMain.handle('save-code-to-file', async (event, code) => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return { success: false, message: '无法获取当前窗口' }

      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: '保存Python代码',
        defaultPath: 'code.py',
        filters: [{ name: 'Python文件', extensions: ['py'] }],
        properties: ['createDirectory']
      })

      if (canceled || !filePath) {
        return { success: false, message: '用户取消了保存操作' }
      }

      // 写入文件
      fs.writeFileSync(filePath, code, 'utf8')
      return { success: true, message: '文件保存成功', filePath }
    } catch (error) {
      console.error('保存文件失败:', error)
      return { success: false, message: `保存文件失败: ${error.message}` }
    }
  })

  // 从本地文件导入Python代码
  ipcMain.handle('import-code-from-file', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return { success: false, message: '无法获取当前窗口' }

      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: '导入Python代码',
        filters: [{ name: 'Python文件', extensions: ['py'] }],
        properties: ['openFile']
      })

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, message: '用户取消了导入操作' }
      }

      // 读取文件
      const code = fs.readFileSync(filePaths[0], 'utf8')
      return { success: true, message: '文件导入成功', code, filePath: filePaths[0] }
    } catch (error) {
      console.error('导入文件失败:', error)
      return { success: false, message: `导入文件失败: ${error.message}` }
    }
  })

  // 处理IPC请求
  ipcMain.handle('python-ipc', async (event, request) => {
    if (!pythonProcess || pythonProcess.killed) {
      pythonProcess = startPythonIpcServer()
      if (!pythonProcess) {
        throw new Error('无法启动Python IPC服务器')
      }
    }

    return new Promise((resolve, reject) => {
      try {
        // 生成唯一请求ID
        const requestId = Date.now().toString() + Math.random().toString().substring(2, 8)

        // 添加请求ID到请求中
        const requestWithId = { ...request, requestId }

        // 存储请求的resolve和reject函数
        pendingRequests.set(requestId, { resolve, reject })

        // 发送请求到Python进程
        const requestString = JSON.stringify(requestWithId) + '\n'
        pythonProcess.stdin.write(requestString)

        // 设置超时
        setTimeout(() => {
          if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId)
            reject(new Error('请求超时'))
          }
        }, 60000) // 增加到60秒超时，给AI响应更多时间
      } catch (error) {
        reject(error)
      }
    })
  })

  // 处理状态持久化相关的IPC请求
  ipcMain.handle('get-state', (event, key, tutorialKey) => {
    switch (key) {
      case 'currentTutorial':
        return stateStore.getCurrentTutorial()
      case 'tutorialState': {
        // 使用传入的tutorialKey参数，而不是依赖event.sender中的值
        const keyToUse = tutorialKey || event.sender['tutorialKey']
        if (!keyToUse) {
          console.warn('获取教程状态失败: 未提供tutorialKey')
          return null
        }
        return stateStore.getTutorialState(keyToUse)
      }
      case 'completedExercises':
        return stateStore.getCompletedExercises()
      case 'theme':
        return stateStore.getTheme()
      default:
        // 对于其他键（如aiSettings），使用通用的getState方法
        return stateStore.getState(key)
    }
  })

  ipcMain.handle('set-current-tutorial', (event, tutorialKey) => {
    stateStore.setCurrentTutorial(tutorialKey)
    // 保存当前教程键，以便在get-state请求中使用
    event.sender.tutorialKey = tutorialKey
    return true
  })

  ipcMain.handle('set-tutorial-state', (event, { tutorialKey, state }) => {
    stateStore.setTutorialState(tutorialKey, state)
    return true
  })

  ipcMain.handle('add-completed-exercise', (event, exerciseId) => {
    stateStore.addCompletedExercise(exerciseId)
    return stateStore.getCompletedExercises()
  })

  ipcMain.handle('set-theme', (event, theme) => {
    stateStore.setTheme(theme)
    return true
  })

  // 处理通用状态设置（包括AI设置）
  ipcMain.handle('set-state', (event, key, value) => {
    return stateStore.setState(key, value)
  })

  // 处理代码编辑内容的持久化
  ipcMain.handle('get-code-editor-content', (event, { tutorialKey, sectionIndex, blockIndex }) => {
    return stateStore.getCodeEditorContent(tutorialKey, sectionIndex, blockIndex)
  })

  ipcMain.handle(
    'set-code-editor-content',
    (event, { tutorialKey, sectionIndex, blockIndex, content }) => {
      stateStore.setCodeEditorContent(tutorialKey, sectionIndex, blockIndex, content)
      return true
    }
  )

  createWindow()

  app.on('activate', function () {
    // On macOS, it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 关闭Python进程，使用更强制的方式
    if (pythonProcess && !pythonProcess.killed) {
      try {
        // 在Windows上使用taskkill强制终止进程
        if (process.platform === 'win32' && pythonProcess.pid) {
          const { execSync } = require('child_process')
          try {
            // 确保使用/t参数终止所有子进程
            execSync(`taskkill /pid ${pythonProcess.pid} /f /t`)
            console.log(`已强制终止Python进程及其子进程(PID: ${pythonProcess.pid})`)

            // 等待一小段时间确保进程完全终止
            setTimeout(() => {
              // 检查进程是否仍然存在
              try {
                execSync(`tasklist /fi "pid eq ${pythonProcess.pid}" /fo csv /nh`)
                console.warn(`Python进程(PID: ${pythonProcess.pid})可能仍在运行，尝试再次终止`)
                execSync(`taskkill /pid ${pythonProcess.pid} /f /t`)
              } catch (checkError) {
                // 如果tasklist命令失败，说明进程已经不存在
                console.log(`确认Python进程(PID: ${pythonProcess.pid})已终止`, checkError)
              }
            }, 500)
          } catch (e) {
            console.error('使用taskkill终止进程失败:', e)
          }
        }

        // 常规终止方式作为备选
        pythonProcess.kill('SIGKILL')
        pythonProcess = null
      } catch (error) {
        console.error('终止Python进程时出错:', error)
      }
    }
    app.quit()
  }
})

// 应用退出时关闭Python进程
app.on('quit', () => {
  if (pythonProcess && !pythonProcess.killed) {
    try {
      // 在Windows上使用taskkill强制终止进程
      if (process.platform === 'win32' && pythonProcess.pid) {
        const { execSync } = require('child_process')
        try {
          // 确保使用/t参数终止所有子进程
          execSync(`taskkill /pid ${pythonProcess.pid} /f /t`)
          console.log(`应用退出时已强制终止Python进程及其子进程(PID: ${pythonProcess.pid})`)

          // 等待一小段时间确保进程完全终止
          setTimeout(() => {
            // 检查进程是否仍然存在
            try {
              execSync(`tasklist /fi "pid eq ${pythonProcess.pid}" /fo csv /nh`)
              console.warn(
                `应用退出时Python进程(PID: ${pythonProcess.pid})可能仍在运行，尝试再次终止`
              )
              execSync(`taskkill /pid ${pythonProcess.pid} /f /t`)
            } catch (checkError) {
              // 如果tasklist命令失败，说明进程已经不存在
              console.log(`应用退出时确认Python进程(PID: ${pythonProcess.pid})已终止`, checkError)
            }
          }, 500)
        } catch (e) {
          console.error('应用退出时使用taskkill终止进程失败:', e)
        }
      }

      // 常规终止方式作为备选
      pythonProcess.kill('SIGKILL')
      pythonProcess = null
    } catch (error) {
      console.error('应用退出时终止Python进程时出错:', error)
    }
  }
})
