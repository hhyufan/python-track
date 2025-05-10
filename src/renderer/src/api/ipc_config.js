// IPC API配置文件
// 替代原有的基于axios的HTTP请求，改为使用Electron的IPC通信

// 辅助函数：将数据转换为Unicode编码
import stringToUnicode from '../utils/unicode'

// 创建API接口对象，模拟axios的API结构
const api = {
  // GET请求
  get: async (url) => {
    try {
      let response
      if (url === '/api/tutorials') {
        response = await window.ipcApi.getTutorials()
        return { data: response.data['tutorials'] }
      } else if (url.startsWith('/api/tutorial/')) {
        const tutorialKey = stringToUnicode(url.split('/').pop())
        response = await window.ipcApi.getTutorial(tutorialKey)
        return { data: response.data }
      }
      throw new Error(`未实现的IPC API路径: ${url}`)
    } catch (error) {
      console.error('IPC API请求错误:', error)
      throw error
    }
  },

  // POST请求
  post: async (url, data) => {
    try {
      let response

      if (url === '/api/run-code') {
        response = await window.ipcApi.runCode(data)
      } else if (url === '/api/hint') {
        response = await window.ipcApi.getHint(data)
      } else if (url === '/api/solution') {
        response = await window.ipcApi.getSolution(data)
      } else if (url === '/api/run-code-simple') {
        response = await window.ipcApi.runCodeSimple(data)
      } else if (url === '/api/test') {
        response = await window.ipcApi.test(data)
      } else {
        throw new Error(`未实现的IPC API路径: ${url}`)
      }

      return { data: response.data }
    } catch (error) {
      console.error('IPC API请求错误:', error)
      throw error
    }
  },

  // 获取模型密钥配置
  getModelKeys: async () => {
    try {
      const response = await window.ipcApi.getModelKeys()
      return { data: response.data } // 假设后端直接返回
    } catch (error) {
      console.error('IPC API请求错误 (getModelKeys):', error)
      throw error
    }
  },

  // 添加或更新模型密钥
  setModelKey: async (baseUrl, modelName,encrypted_api_key, aes_key, iv) => {
    try {
      const response = await window.ipcApi.setModelKey(baseUrl, modelName,encrypted_api_key, aes_key, iv)
      return { data: response.data } // 假设后端返回成功或错误信息
    } catch (error) {
      console.error('IPC API请求错误 (setModelKey):', error)
      throw error
    }
  },

  // 删除模型或密钥
  deleteModelKey: async (modelName) => {
    try {
      const response = await window.ipcApi.deleteModelKey(modelName)
      return { data: response.data } // 假设后端返回成功或错误信息
    } catch (error) {
      console.error('IPC API请求错误 (deleteModelKey):', error)
      throw error
    }
  },

  // Check API Key Status
  checkApiKey: async () => {
    try {
      const response = await window.ipcApi.checkApiKey()
      return { data: response.data } // Assuming backend returns { status: 'valid'/'missing' } or error
    } catch (error) {
      console.error('IPC API请求错误 (checkApiKey):', error)
      throw error
    }
  }
}

export default api
