import { useState, useEffect } from 'react'
import { Layout, ConfigProvider, theme, Button, FloatButton } from 'antd'
import { Routes, Route, Navigate } from 'react-router-dom'
import { SunOutlined, MoonFilled } from '@ant-design/icons'
import AppHeader from './components/AppHeader'
import Sidebar from './components/Sidebar'
import TutorialView from './pages/TutorialView'
import './App.scss'
import AISetupModal from './components/AISetUpModel'

const { Content } = Layout

const App = () => {
  // 主题设置
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // 首先尝试从localStorage获取（向后兼容）
    const savedTheme = localStorage.getItem('theme')
    if (savedTheme) {
      return savedTheme === 'dark'
    }
    // 如果没有，尝试从electron-store获取
    if (window.ipcApi && window.ipcApi.getTheme) {
      // 由于useState不能直接使用异步函数，我们先返回系统默认值
      // 然后在useEffect中异步加载保存的主题
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    // 如果都没有，使用系统默认值
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const [lastTutorialPath, setLastTutorialPath] = useState(() => {
    const savedPath = localStorage.getItem('lastTutorialPath')
    return savedPath || '/tutorial/基础知识'
  })

  const [showAISetup, setShowAISetup] = useState(false)
  const [aiErrorMessage, setAiErrorMessage] = useState(null)

  useEffect(() => {
    // 检查是否已经完成 AI 设置
    const checkAISettings = async () => {
      // 首先尝试从electron-store获取
      if (window.ipcApi && window.ipcApi.getState) {
        try {
          const storeSettings = await window.ipcApi.getState('aiSettings')
          if (storeSettings) {
            // 如果从electron-store获取成功，同时更新到localStorage（向后兼容）
            localStorage.setItem('aiSettings', JSON.stringify(storeSettings))
            return true
          }
        } catch (error) {
          console.error('从electron-store获取AI设置失败:', error)
        }
      }

      // 如果从electron-store获取失败，尝试从localStorage获取（向后兼容）
      const localSettings = localStorage.getItem('aiSettings')
      if (localSettings) {
        // 如果从localStorage获取成功，同时保存到electron-store
        if (window.ipcApi && window.ipcApi.setState) {
          try {
            await window.ipcApi.setState('aiSettings', JSON.parse(localSettings))
          } catch (error) {
            console.error('同步AI设置到electron-store失败:', error)
          }
        }
        return true
      }

      // 如果都没有设置，返回false
      return false
    }

    // 执行检查
    checkAISettings().then((hasSettings) => {
      if (!hasSettings) {
        setShowAISetup(true)
      }
    })

    // 添加全局事件监听器，用于处理401错误
    const handleAuthError = (event) => {
      const { error } = event.detail
      setAiErrorMessage(error)
      setShowAISetup(true)
    }

    window.addEventListener('ai-auth-error', handleAuthError)

    return () => {
      window.removeEventListener('ai-auth-error', handleAuthError)
    }
  }, [])

  const handleAISetupComplete = (values) => {
    setShowAISetup(false)
    setAiErrorMessage(null)

    // 保存到electron-store
    if (window.ipcApi && window.ipcApi.setState) {
      window.ipcApi.setState('aiSettings', values).catch((error) => {
        console.error('保存AI设置到electron-store失败:', error)
      })
    }

    // 同时保存到localStorage（向后兼容）
    localStorage.setItem('aiSettings', JSON.stringify(values))

    // 这里可以初始化 AI 相关功能
    console.log('AI settings:', values)
  }

  // 切换主题
  const toggleTheme = () => {
    const newTheme = !isDarkMode
    setIsDarkMode(newTheme)

    // 保存到localStorage（向后兼容）
    localStorage.setItem('theme', newTheme ? 'dark' : 'light')

    // 同时保存到electron-store
    if (window.ipcApi && window.ipcApi.setTheme) {
      window.ipcApi.setTheme(newTheme ? 'dark' : 'light').catch((error) => {
        console.error('保存主题设置失败:', error)
      })
    }

    document.documentElement.setAttribute('data-theme', newTheme ? 'dark' : 'light')
  }

  // 初始化主题
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light')
  }, [isDarkMode])

  // 从electron-store加载保存的主题
  useEffect(() => {
    ;(async () => {
      if (window.ipcApi && window.ipcApi.getTheme) {
        try {
          const savedTheme = await window.ipcApi.getTheme()
          if (savedTheme) {
            const isDark = savedTheme === 'dark'
            setIsDarkMode(isDark)
            document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
          }
        } catch (error) {
          console.error('加载保存的主题设置失败:', error)
        }
      }
    })()
  }, [])
  useEffect(() => {
    const handleRouteChange = () => {
      const currentPath = window.location.pathname
      if (currentPath.startsWith('/tutorial/')) {
        // 保存到localStorage（向后兼容）
        localStorage.setItem('lastTutorialPath', currentPath)
        setLastTutorialPath(currentPath)

        // 从路径中提取教程键
        const tutorialKey = currentPath.replace('/tutorial/', '')
        // 同时保存到electron-store
        if (window.ipcApi && window.ipcApi.setCurrentTutorial) {
          window.ipcApi.setCurrentTutorial(tutorialKey).catch((error) => {
            console.error('保存当前教程失败:', error)
          })
        }
      }
    }

    // 初始化时监听路由变化
    const unsubscribe = window.router?.subscribe(handleRouteChange)
    // 初始化时也执行一次，确保当前路径被保存
    handleRouteChange()
    return () => unsubscribe?.()
  }, [])

  return (
    <ConfigProvider
      theme={{
        algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 4,
          fontFamily:
            '"Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
        }
      }}
    >
      <Layout className="app-layout">
        <AppHeader />
        <Layout>
          <Sidebar />
          <Content className="app-content">
            <div className="theme-toggle">
              <Button
                type="text"
                icon={isDarkMode ? <MoonFilled /> : <SunOutlined />}
                onClick={toggleTheme}
                title={isDarkMode ? '切换到亮色模式' : '切换到暗色模式'}
                className="theme-toggle-btn"
              />
            </div>
            <div className="content-container">
              <Routes>
                <Route path="/" element={<Navigate to={lastTutorialPath} replace />} />
                <Route path="/tutorial/:tutorialKey" element={<TutorialView />} />
              </Routes>
            </div>
            {/* 返回顶部悬浮按钮 */}
            <FloatButton.BackTop
              target={() => document.querySelector('.app-content')}
              tooltip="返回顶部"
              visibilityHeight={100}
            />
          </Content>
          <AISetupModal
            visible={showAISetup}
            onComplete={handleAISetupComplete}
            errorMessage={aiErrorMessage}
          />
        </Layout>
      </Layout>
    </ConfigProvider>
  )
}

export default App
