"use client"

import React, { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "../lib/utils"
import { marked } from "marked"
import { 
  MessageCircle, 
  Upload, 
  Send, 
  User, 
  AlertTriangle,
  Camera,
  Heart,
  Mic,
  Loader2,
  CheckCircle,
  Info,
  Clock,
  FileText,
  TrendingUp,

  Play,
  Pause,
  Square,
  Volume2
} from "lucide-react"
import ReportDisplay from './ReportDisplay'

// 在文件顶部添加API基础URL配置
const API_BASE_URL = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001';

// 配置marked选项以确保安全渲染
marked.setOptions({
  breaks: true, // 支持换行
  gfm: true,    // 支持GitHub风格的Markdown
})

// 安全渲染Markdown到HTML的函数
const renderMarkdown = (content: string): string => {
  try {
    return marked(content) as string
  } catch (error) {
    console.error('Markdown渲染错误:', error)
    return content // 如果渲染失败，返回原始文本
  }
}

// 基础组件
const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "default" | "outline" | "ghost"
    size?: "default" | "sm" | "lg" | "icon"
  }
>(({ className, variant = "default", size = "default", ...props }, ref) => {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:pointer-events-none disabled:opacity-50",
        {
                  "bg-amber-500 text-black hover:bg-amber-600": variant === "default",
        "border border-amber-300 bg-white hover:bg-amber-50": variant === "outline",
        "hover:bg-amber-100": variant === "ghost",
        },
        {
          "h-10 px-4 py-2": size === "default",
          "h-9 rounded-md px-3": size === "sm",
          "h-11 rounded-md px-8": size === "lg",
          "h-10 w-10": size === "icon",
        },
        className
      )}
      ref={ref}
      {...props}
    />
  )
})

const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-lg border border-amber-600 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-amber-600 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-lg border border-amber-600 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-amber-600 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})

const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => {
  return (
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-amber-800",
        className
      )}
      {...props}
    />
  )
})

// 文件上传组件
interface FileUploadProps {
  onChange?: (files: File[]) => void
  className?: string
  uploadedFiles?: File[]
}

const FileUpload: React.FC<FileUploadProps> = ({ onChange, className, uploadedFiles = [] }) => {
  const [files, setFiles] = useState<File[]>(uploadedFiles)
  const [isDragActive, setIsDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    setFiles(uploadedFiles)
  }, [uploadedFiles])

  const handleFileChange = (newFiles: File[]) => {
    console.log('🔄 FileUpload: 文件选择事件触发');
    console.log('   新选择的文件数:', newFiles.length);
    console.log('   当前已有文件数:', files.length);
    
    if (newFiles.length === 0) {
      console.log('⚠️ 没有选择任何文件');
      return;
    }
    
    // 验证和过滤文件
    const validFiles: File[] = [];
    const invalidFiles: string[] = [];
    
    newFiles.forEach((file, index) => {
      console.log(`🔍 验证文件 ${index + 1}: ${file.name}`);
      
      // 基本验证
      if (!(file instanceof File)) {
        invalidFiles.push(`文件 ${index + 1} 不是有效的 File 对象`);
        console.error(`❌ 文件 ${index + 1} 不是有效的 File 对象:`, file);
        return;
      }
      
      // 大小验证 (10MB限制)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        invalidFiles.push(`"${file.name}" 超过10MB大小限制`);
        console.error(`❌ 文件过大: ${file.name} (${Math.round(file.size / 1024 / 1024)}MB)`);
        return;
      }
      
      if (file.size === 0) {
        invalidFiles.push(`"${file.name}" 文件大小为0`);
        console.error(`❌ 文件大小为0: ${file.name}`);
        return;
      }
      
      // 类型验证
      if (!file.type.startsWith('image/')) {
        invalidFiles.push(`"${file.name}" 不是图片格式`);
        console.error(`❌ 文件类型错误: ${file.name} (${file.type})`);
        return;
      }
      
      // 文件名验证
      if (!file.name || file.name.trim() === '') {
        invalidFiles.push(`文件 ${index + 1} 没有有效的文件名`);
        console.error(`❌ 文件名无效:`, file);
        return;
      }
      
      // 检查重复文件
      const isDuplicate = files.some(existingFile => 
        existingFile.name === file.name && 
        existingFile.size === file.size &&
        existingFile.lastModified === file.lastModified
      );
      
      if (isDuplicate) {
        invalidFiles.push(`"${file.name}" 已经存在`);
        console.warn(`⚠️ 重复文件: ${file.name}`);
        return;
      }
      
      // 文件通过所有验证
      validFiles.push(file);
      console.log(`✅ 文件验证通过: ${file.name} (${Math.round(file.size / 1024)}KB, ${file.type})`);
    });
    
    // 显示验证结果
    if (invalidFiles.length > 0) {
      console.warn('⚠️ 发现无效文件:');
      invalidFiles.forEach(error => console.warn(`   - ${error}`));
      
      // 可以在这里添加用户提示
      if (validFiles.length === 0) {
        console.error('❌ 所有文件都无效，取消操作');
        return;
      }
    }
    
    console.log(`📊 文件验证结果: ${validFiles.length} 个有效文件, ${invalidFiles.length} 个无效文件`);
    
    if (validFiles.length > 0) {
      console.log('📁 有效文件详情:');
      validFiles.forEach((file, index) => {
        console.log(`   文件 ${index + 1}:`);
        console.log(`     名称: ${file.name}`);
        console.log(`     大小: ${Math.round(file.size / 1024)}KB`);
        console.log(`     类型: ${file.type}`);
        console.log(`     最后修改: ${new Date(file.lastModified).toLocaleString()}`);
        console.log(`     File对象: ${file instanceof File ? '✅' : '❌'}`);
      });
    }
    
    // 更新文件列表 - 添加到现有文件而不是替换
    const updatedFiles = [...files, ...validFiles];
    console.log('📝 更新文件状态:');
    console.log(`   原有文件数: ${files.length}`);
    console.log(`   新增文件数: ${validFiles.length}`);
    console.log(`   总文件数: ${updatedFiles.length}`);
    
    setFiles(updatedFiles);
    
    // 立即通知父组件
    if (onChange) {
      console.log('📡 通知父组件文件状态更新');
      onChange(updatedFiles);
    } else {
      console.warn('⚠️ 没有设置 onChange 回调函数');
    }
    
    console.log('✅ FileUpload: 文件状态已更新，已通知父组件');
    
    // 清空文件输入框，允许重复选择相同文件
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragActive(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragActive(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragActive(false)
    const droppedFiles = Array.from(e.dataTransfer.files)
    handleFileChange(droppedFiles)
  }

  return (
    <div className={cn("w-full", className)}>
      <motion.div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        whileHover={{ scale: 1.02 }}
        className={cn(
          "p-6 group block rounded-lg cursor-pointer w-full relative overflow-hidden border-2 border-dashed transition-colors",
          isDragActive 
            ? "border-amber-500 bg-amber-100" 
            : "border-amber-300 bg-amber-50 hover:bg-amber-100"
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          onChange={(e) => handleFileChange(Array.from(e.target.files || []))}
          className="hidden"
          accept="image/*"
          multiple
        />
        
        <div className="flex flex-col items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-amber-200 flex items-center justify-center mb-3">
            <Upload className="w-6 h-6 text-amber-600" />
          </div>
          <p className="font-medium text-amber-800 mb-1">
            上传聊天记录截图或其他补充材料
          </p>
          <p className="text-amber-600 text-sm text-center">
            让AI进行深度分析，拖拽文件到这里或点击选择
          </p>
        </div>

        {files.length > 0 && (
          <div className="mt-4 space-y-2">
            {files.map((file, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-lg p-3 shadow-sm border border-amber-200"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Camera className="w-4 h-4 text-amber-500" />
                    <span className="text-sm font-medium text-amber-800 truncate">
                      {file.name}
                    </span>
                  </div>
                  <span className="text-xs text-amber-500">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  )
}

// 聊天消息接口
interface ChatMessage {
  id: string
  content: string
  sender: "user" | "assistant"
  timestamp: string
  type?: "text" | "audio"
  audioBlob?: Blob
  duration?: number
}

// 报告数据接口 - 匹配后端返回的数据结构
interface ReportData {
  risk_level: string
  key_findings: {
    [key: string]: any
  }
  final_suggestion: string
  confidence_level: string
  professional_insight?: string
  analysis_metadata?: {
    processed_images: number
    analysis_timestamp: string
    processing_time: string
  }
}

// 聊天界面组件
interface ChatInterfaceProps {
  messages?: ChatMessage[]
  onSendMessage?: (message: string) => void
  className?: string
}

// 语音条动画组件
const VoiceWaveform: React.FC<{ isRecording: boolean, time: number }> = ({ isRecording, time }) => {
  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  return (
    <div className="flex items-center space-x-3 p-3 bg-red-50 border border-red-200 rounded-2xl">
      <div className="flex items-center space-x-1">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className={cn(
              "w-1 bg-red-500 rounded-full transition-all duration-150",
              isRecording ? "animate-pulse" : ""
            )}
            style={{
              height: isRecording 
                ? `${8 + Math.sin((Date.now() / 100) + i) * 4}px` 
                : "4px"
            }}
          />
        ))}
      </div>
      <span className="text-sm text-red-600 font-medium">
        {formatTime(time)}
      </span>
      <span className="text-xs text-red-500">
        录音中...
      </span>
    </div>
  )
}

// 语音消息播放组件
const VoiceMessage: React.FC<{ 
  audioBlob: Blob, 
  duration?: number,
  isFromUser: boolean 
}> = ({ audioBlob, duration, isFromUser }) => {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [totalDuration, setTotalDuration] = useState(duration || 0)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const audioUrl = URL.createObjectURL(audioBlob)
    if (audioRef.current) {
      audioRef.current.src = audioUrl
    }
    return () => URL.revokeObjectURL(audioUrl)
  }, [audioBlob])

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause()
      } else {
        audioRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.floor(seconds % 60)
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  return (
    <div className="flex items-center space-x-3 min-w-[200px]">
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setTotalDuration(e.currentTarget.duration)}
        onEnded={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
      
      <button
        onClick={togglePlay}
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
          isFromUser 
            ? "bg-white/20 hover:bg-white/30 text-white" 
            : "bg-amber-100 hover:bg-amber-200 text-amber-600"
        )}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4" />
        ) : (
          <Play className="w-4 h-4 ml-0.5" />
        )}
      </button>

      <div className="flex-1 flex items-center space-x-2">
        <div className="flex items-center space-x-1">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-1 rounded-full transition-all duration-200",
                isFromUser ? "bg-white/40" : "bg-amber-300",
                isPlaying && i < (currentTime / totalDuration) * 8 
                  ? (isFromUser ? "bg-white" : "bg-amber-600")
                  : ""
              )}
              style={{
                height: `${4 + Math.sin(i * 0.5) * 2}px`
              }}
            />
          ))}
        </div>
        
        <span className={cn(
          "text-xs",
          isFromUser ? "text-white/80" : "text-amber-500"
        )}>
          {formatTime(currentTime)} / {formatTime(totalDuration)}
        </span>
      </div>

      <Volume2 className={cn(
        "w-4 h-4",
        isFromUser ? "text-white/60" : "text-amber-400"
      )} />
    </div>
  )
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
  messages = [], 
  onSendMessage,
  className 
}) => {
  const [inputValue, setInputValue] = useState("")
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(messages)
  const [isRecording, setIsRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [recordingTime, setRecordingTime] = useState(0)
  const [recordingTimer, setRecordingTimer] = useState<NodeJS.Timeout | null>(null)

  // 开始录音
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: BlobPart[] = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
        }
      }

      recorder.onstop = () => {
        const audioBlob = new Blob(chunks, { type: 'audio/wav' })
        setAudioBlob(audioBlob)
        stream.getTracks().forEach(track => track.stop())
      }

      recorder.start()
      setMediaRecorder(recorder)
      setIsRecording(true)
      
      // 启动录音计时器
      setRecordingTime(0)
      const timer = setInterval(() => {
        setRecordingTime(prev => prev + 1)
      }, 1000)
      setRecordingTimer(timer)
    } catch (error) {
      console.error('录音权限被拒绝或设备不支持:', error)
      alert('无法访问麦克风，请检查权限设置')
    }
  }

  // 停止录音
  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop()
      setIsRecording(false)
      setMediaRecorder(null)
      
      // 清除录音计时器
      if (recordingTimer) {
        clearInterval(recordingTimer)
        setRecordingTimer(null)
      }
    }
  }

  // 发送音频消息
  const sendAudioMessage = async () => {
    if (!audioBlob) return

    // 创建语音消息
    const audioMessage: ChatMessage = {
      id: Date.now().toString(),
      content: "🎤 语音消息",
      sender: "user",
      timestamp: new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
      type: "audio",
      audioBlob: audioBlob,
      duration: recordingTime
    }

    setChatMessages(prev => [...prev, audioMessage])
    
    // 添加加载状态消息
    const loadingMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      content: "正在转录语音并分析您的情况，请稍候...",
      sender: "assistant",
      timestamp: new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
    }
    setChatMessages(prev => [...prev, loadingMessage])

    // 保存音频blob的引用，稍后清理
    const currentAudioBlob = audioBlob
    setAudioBlob(null)

    // 调用约会后复盘API（带音频）
    try {
      const formData = new FormData()
      formData.append('user_input', '语音消息')
      formData.append('conversation_history', JSON.stringify(chatMessages))
      formData.append('audio', currentAudioBlob, 'recording.wav')

      const response = await fetch(`${API_BASE_URL}/api/post_date_debrief`, {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      
      if (result.success) {
        // 更新用户消息显示转录内容
        setChatMessages(prev => {
          const updated = [...prev]
          const userMsgIndex = updated.findIndex(msg => msg.id === audioMessage.id)
          if (userMsgIndex !== -1 && result.metadata?.transcription?.transcription) {
            updated[userMsgIndex] = {
              ...updated[userMsgIndex],
              content: result.metadata.transcription.transcription
            }
          }
          return updated
        })

        // 移除加载消息并添加真实回复
        setChatMessages(prev => {
          const withoutLoading = prev.slice(0, -1)
          const assistantResponse: ChatMessage = {
            id: (Date.now() + 2).toString(),
            content: result.response,
            sender: "assistant",
            timestamp: new Date().toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            }),
          }
          return [...withoutLoading, assistantResponse]
        })
      } else {
        throw new Error(result.error || '语音分析失败')
      }
    } catch (error) {
      console.error('语音分析API调用失败:', error)
      
      // 移除加载消息并添加错误回复
      setChatMessages(prev => {
        const withoutLoading = prev.slice(0, -1)
        const errorResponse: ChatMessage = {
          id: (Date.now() + 2).toString(),
          content: `很抱歉，语音转录失败。错误信息：${error.message}。请尝试重新录制或使用文字输入。`,
          sender: "assistant",
          timestamp: new Date().toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          }),
        }
        return [...withoutLoading, errorResponse]
      })
    }
  }

  // 当有音频blob时自动发送
  React.useEffect(() => {
    if (audioBlob) {
      sendAudioMessage()
    }
  }, [audioBlob])

  const handleSendMessage = () => {
    if (!inputValue.trim()) return

    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      content: inputValue,
      sender: "user",
      timestamp: new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
    }

    setChatMessages(prev => [...prev, newMessage])
    const currentInput = inputValue
    setInputValue("")
    onSendMessage?.(currentInput)

    // 添加加载状态消息
    const loadingMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
      content: "正在分析您的情况，请稍候...",
        sender: "assistant",
        timestamp: new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }),
      }
    setChatMessages(prev => [...prev, loadingMessage])

    // 调用约会后复盘API
    const callPostDateDebriefAPI = async () => {
      try {
        const formData = new FormData()
        formData.append('user_input', currentInput)
        formData.append('conversation_history', JSON.stringify(chatMessages))
        
        // 注意：这里不发送音频文件，只有在录音时才发送音频

        const response = await fetch(`${API_BASE_URL}/api/post_date_debrief`, {
          method: 'POST',
          body: formData
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const result = await response.json()
        
        if (result.success) {
          // 移除加载消息并添加真实回复
          setChatMessages(prev => {
            const withoutLoading = prev.slice(0, -1) // 移除加载消息
            const assistantResponse: ChatMessage = {
              id: (Date.now() + 2).toString(),
              content: result.response,
              sender: "assistant",
              timestamp: new Date().toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              }),
            }
            return [...withoutLoading, assistantResponse]
          })
        } else {
          throw new Error(result.error || '分析失败')
        }
      } catch (error) {
        console.error('约会后复盘API调用失败:', error)
        
        // 移除加载消息并添加错误回复
        setChatMessages(prev => {
          const withoutLoading = prev.slice(0, -1) // 移除加载消息
          const errorResponse: ChatMessage = {
            id: (Date.now() + 2).toString(),
            content: `很抱歉，我暂时无法为您提供专业建议。错误信息：${error.message}。请稍后再试，或者尝试重新描述您的问题。`,
            sender: "assistant",
            timestamp: new Date().toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            }),
          }
          return [...withoutLoading, errorResponse]
        })
      }
    }

    // 异步调用API
    callPostDateDebriefAPI()
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* 聊天消息区域 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-amber-25 to-white">
        {chatMessages.length === 0 && (
          <div className="text-center py-8">
            <MessageCircle className="w-12 h-12 text-amber-300 mx-auto mb-4" />
            <p className="text-amber-600">开始您的约会后反思...</p>
            <p className="text-amber-500 text-sm mt-2">分享您的感受，我会帮助您处理这些情感</p>
          </div>
        )}
        
        {chatMessages.map((message) => (
          <motion.div
            key={message.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "flex",
              message.sender === "user" ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={cn(
                "px-5 py-4 rounded-2xl", // 增加内边距从px-4 py-3改为px-5 py-4
                message.sender === "user"
                  ? "bg-amber-500 text-white rounded-br-md border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.8)] max-w-[75%]" // 用户消息保持75%宽度
                  : "bg-white border-2 border-black text-amber-800 rounded-bl-md shadow-[4px_4px_0px_0px_rgba(0,0,0,0.8)] max-w-[80%]" // AI消息调整为80%宽度
              )}
            >
              {message.type === "audio" && message.audioBlob ? (
                <VoiceMessage 
                  audioBlob={message.audioBlob}
                  duration={message.duration}
                  isFromUser={message.sender === "user"}
                />
              ) : (
                <div 
                  className={cn(
                    "prose prose-base max-w-none leading-relaxed", // 从text-sm prose-sm改为prose-base，添加leading-relaxed(1.625)
                    message.sender === "user" 
                      ? "prose-invert [&>*]:text-white [&_strong]:text-white [&_em]:text-white [&>p]:text-base [&>p]:leading-[1.7]" // 用户消息
                      : cn(
                          "prose-amber [&>*]:text-amber-800", 
                          // 正文字体优化：16px字体，1.7行高
                          "[&>p]:text-base [&>p]:leading-[1.7] [&>p]:text-amber-800",
                          // 标题层级优化：粗体 + 减少上方间距
                          "[&>h1]:font-bold [&>h1]:text-amber-900 [&>h1]:mt-3 [&>h1:first-child]:mt-0",
                          "[&>h2]:font-bold [&>h2]:text-amber-900 [&>h2]:mt-3 [&>h2:first-child]:mt-0", 
                          "[&>h3]:font-bold [&>h3]:text-amber-900 [&>h3]:mt-2 [&>h3:first-child]:mt-0",
                          "[&>h4]:font-bold [&>h4]:text-amber-900 [&>h4]:mt-2 [&>h4:first-child]:mt-0",
                          // 强调文本样式
                          "[&_strong]:text-amber-900 [&_strong]:font-bold",
                          "[&_em]:text-amber-700 [&_em]:italic",
                          // 列表样式优化
                          "[&>ul]:text-base [&>ul]:leading-[1.7] [&>ul]:text-amber-800",
                          "[&>ol]:text-base [&>ol]:leading-[1.7] [&>ol]:text-amber-800",
                          "[&>ul>li]:text-base [&>ul>li]:leading-[1.7] [&>ul>li]:text-amber-800",
                          "[&>ol>li]:text-base [&>ol>li]:leading-[1.7] [&>ol>li]:text-amber-800"
                        ),
                    // 减少段落和列表的间距，压缩留白
                    "[&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1", // 从my-2改回my-1，减少垂直间距
                    "[&>p:first-child]:mt-0 [&>p:last-child]:mb-0",
                    "[&>ul:first-child]:mt-0 [&>ul:last-child]:mb-0",
                    "[&>ol:first-child]:mt-0 [&>ol:last-child]:mb-0"
                  )}
                  dangerouslySetInnerHTML={{ 
                    __html: renderMarkdown(message.content) 
                  }}
                />
              )}
              <p className={cn(
                "text-xs mt-2", // 从mt-1改为mt-2，增加时间戳上方间距
                message.sender === "user" ? "text-amber-100" : "text-amber-500"
              )}>
                {message.timestamp}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* 输入区域 */}
      <div className="p-4 border-t-2 border-black bg-white">
        {/* 录音时的语音条显示 */}
        {isRecording && (
          <div className="mb-3">
            <VoiceWaveform isRecording={isRecording} time={recordingTime} />
          </div>
        )}
        
        <div className="flex items-center space-x-3">
          <div className="flex-1 relative">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSendMessage()
                }
              }}
              placeholder="分享您的想法和感受..."
              className="pr-12 rounded-full border-2 border-black focus:border-amber-500 focus:ring-amber-500 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.8)] text-gray-900 placeholder:text-amber-600"
            />
          </div>
          
          {/* 麦克风按钮 - 按住说话 */}
          <Button
            size="icon"
            variant="outline"
            className={cn(
              "rounded-full border-2 border-black hover:border-amber-500 hover:bg-amber-50 text-amber-600 transition-all duration-150 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.8)]",
              isRecording ? "bg-red-100 border-red-300 text-red-600" : ""
            )}
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onMouseLeave={stopRecording}
            title={isRecording ? "松开结束录音" : "按住说话"}
          >
            <Mic className={cn("w-5 h-5", isRecording ? "animate-pulse" : "")} />
          </Button>
          
          <Button
            onClick={handleSendMessage}
            size="icon"
            className="rounded-full bg-amber-500 hover:bg-amber-600 text-black border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,0.8)]"
          >
            <Send className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// 主应用组件
interface EmotionalSafetyAppProps {
  className?: string
}

// 任务状态接口
interface TaskStatus {
  taskId: string | null
  status: 'idle' | 'creating' | 'processing' | 'completed' | 'failed'
  progress: number
  currentStep: string
  estimatedTime?: string
}

const EmotionalSafetyApp: React.FC<EmotionalSafetyAppProps> = ({ className }) => {
  const [activeTab, setActiveTab] = useState("pre-date")
  const [formData, setFormData] = useState({
    nickname: "",
    profession: "",
    age: "",
    bioOrChatHistory: ""
  })
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [report, setReport] = useState<ReportData | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  // 新增：任务状态管理
  const [taskStatus, setTaskStatus] = useState<TaskStatus>({
    taskId: null,
    status: 'idle',
    progress: 0,
    currentStep: '',
    estimatedTime: ''
  })
  
  // 新增：Pre-Date视图状态管理
  const [preDateView, setPreDateView] = useState<"form" | "report">("form")

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleFilesChange = (files: File[]) => {
    console.log('🔄 主组件: 接收到文件更新通知');
    console.log('   接收到的文件数:', files.length);
    
    if (files.length > 0) {
      files.forEach((file, index) => {
        console.log(`   文件 ${index + 1}: ${file.name} (${Math.round(file.size / 1024)}KB, ${file.type})`);
      });
    }
    
    setUploadedFiles(files)
    console.log('✅ 主组件: uploadedFiles 状态已更新');
  }

  // 轮询状态检查函数（带UI更新）
  const pollTaskStatus = async (taskId: string): Promise<any> => {
    const maxPolls = 60; // 最多轮询60次（5分钟）
    const pollInterval = 5000; // 每5秒轮询一次
    
    // 初始设置任务状态
    setTaskStatus({
      taskId,
      status: 'processing',
      progress: 0,
      currentStep: '开始处理任务...',
      estimatedTime: ''
    });
    
    for (let i = 0; i < maxPolls; i++) {
      console.log(`🔄 轮询状态 ${i + 1}/${maxPolls}: ${taskId}`);
      
      try {
        const statusResponse = await fetch(`${API_BASE_URL}/api/report_status/${taskId}`);
        
        if (!statusResponse.ok) {
          throw new Error(`状态查询失败: ${statusResponse.status} ${statusResponse.statusText}`);
        }
        
        const statusResult = await statusResponse.json();
        console.log(`📊 任务状态: ${statusResult.status} - ${statusResult.current_step} (${statusResult.progress}%)`);
        
        // 实时更新UI状态
        setTaskStatus({
          taskId,
          status: 'processing',
          progress: statusResult.progress || 0,
          currentStep: statusResult.current_step || '处理中...',
          estimatedTime: ''
        });
        
        if (statusResult.completed) {
          if (statusResult.failed) {
            console.error('❌ 任务执行失败:', statusResult.error);
            setTaskStatus({
              taskId,
              status: 'failed',
              progress: 0,
              currentStep: '任务执行失败',
              estimatedTime: ''
            });
            throw new Error(statusResult.error || '分析任务失败');
          } else {
            console.log('✅ 任务完成，返回结果');
            setTaskStatus({
              taskId,
              status: 'completed',
              progress: 100,
              currentStep: '分析完成',
              estimatedTime: ''
            });
            return statusResult.result;
          }
        }
        
        // 等待下次轮询
        if (i < maxPolls - 1) {
          console.log(`⏰ 等待 ${pollInterval/1000} 秒后继续轮询...`);
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
        
      } catch (pollError) {
        console.error(`❌ 轮询 ${i + 1} 失败:`, pollError.message);
        if (i === maxPolls - 1) {
          setTaskStatus({
            taskId,
            status: 'failed',
            progress: 0,
            currentStep: '轮询失败',
            estimatedTime: ''
          });
          throw pollError;
        }
        // 短暂等待后重试
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    setTaskStatus({
      taskId,
      status: 'failed',
      progress: 0,
      currentStep: '任务超时',
      estimatedTime: ''
    });
    throw new Error('任务执行超时，请稍后重试');
  };

  // 处理返回表单视图
  const handleBackToForm = () => {
    setPreDateView("form");
    // 可选：清除报告和错误状态
    setReport(null);
    setError(null);
  };

  const handleGenerateReport = async () => {
    console.log('🚀 ===== 开始异步生成报告流程 =====');
    console.log('📋 第1步：当前文件状态检查');
    console.log('   uploadedFiles 数组长度:', uploadedFiles.length);
    console.log('   uploadedFiles 是否为数组:', Array.isArray(uploadedFiles));
    
    if (uploadedFiles.length > 0) {
      console.log('📁 已上传的文件详情:');
      uploadedFiles.forEach((file, index) => {
        console.log(`   文件 ${index + 1}: ${file.name} (${Math.round(file.size / 1024)}KB, ${file.type})`);
      });
    } else {
      console.log('⚠️ 当前没有选择任何文件');
    }
    
    // 表单数据验证
    const currentFormData = {
      nickname: formData.nickname?.trim() || '',
      profession: formData.profession?.trim() || '',
      age: formData.age?.trim() || '',
      bioOrChatHistory: formData.bioOrChatHistory?.trim() || ''
    };
    
    console.log('📝 当前表单数据:');
    Object.entries(currentFormData).forEach(([key, value]) => {
      console.log(`   ${key}: "${value}" (长度: ${value.length})`);
    });
    
    // 数据验证
    if (!currentFormData.nickname) {
      console.error('❌ 验证失败: 昵称不能为空');
      setError('请输入对方昵称');
      return;
    }
    
    setIsGenerating(true);
    setError(null);
    setReport(null); // 清除之前的报告
    
    // 设置任务创建状态
    setTaskStatus({
      taskId: null,
      status: 'creating',
      progress: 0,
      currentStep: '正在创建分析任务...',
      estimatedTime: ''
    });
    
    try {
      console.log('📋 第2步：构建FormData对象');
      const formDataToSend = new FormData();
      
      // 添加文本数据
      Object.entries(currentFormData).forEach(([key, value]) => {
        formDataToSend.append(key, value);
        console.log(`   ✅ 已添加: ${key} = "${value}"`);
      });
      
      formDataToSend.append('analysis_context', '用户请求进行约会前安全评估分析');
      
      // 添加文件
      console.log('📎 第3步：添加文件到FormData');
      if (uploadedFiles.length === 0) {
        console.log('⚠️ 没有文件需要上传，将只发送文本数据');
      } else {
      uploadedFiles.forEach((file, index) => {
          // 验证文件对象的有效性
          if (!(file instanceof File)) {
            throw new Error(`文件 ${index + 1} 无效`);
          }
          
          if (file.size === 0) {
            throw new Error(`文件 "${file.name}" 大小为0，可能已损坏`);
          }
          
          if (!file.type.startsWith('image/')) {
            throw new Error(`文件 "${file.name}" 不是图片格式`);
          }
          
          formDataToSend.append('images', file);
          console.log(`   ✅ 已添加文件 ${index + 1}: ${file.name} (${Math.round(file.size / 1024)}KB)`);
        });
      }
      
      // 提交任务到后端
      console.log('🚀 第4步：提交任务到后端');
      const startTime = Date.now();
      const response = await fetch(`${API_BASE_URL}/api/generate_warning_report`, {
        method: 'POST',
        body: formDataToSend,
      });
      
      const submitTime = Date.now() - startTime;
      console.log(`⏱️ 任务提交时间: ${submitTime}ms`);
      console.log(`📊 响应状态: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ 任务提交失败: ${response.status} ${response.statusText}`);
        console.error('📄 错误详情:', errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      const taskResponse = await response.json();
      console.log('📋 任务提交响应:', taskResponse);
      
      if (!taskResponse.success || !taskResponse.task_id) {
        console.error('❌ 任务创建失败:', taskResponse.error);
        throw new Error(taskResponse.error || '任务创建失败');
      }
      
      const taskId = taskResponse.task_id;
      console.log(`✅ 任务已创建: ${taskId}`);
      console.log(`⏰ 预计处理时间: ${taskResponse.estimated_time}`);
      
      // 更新任务状态 - 任务已创建，准备开始轮询
      setTaskStatus({
        taskId,
        status: 'processing',
        progress: 5,
        currentStep: '任务已创建，开始处理...',
        estimatedTime: taskResponse.estimated_time
      });
      
      // 开始轮询任务状态
      console.log('🔄 第5步：开始轮询任务状态');
      const result = await pollTaskStatus(taskId);
      
      console.log('✅ 第6步：解析最终结果');
      console.log('📊 响应结构验证:');
      console.log(`   success: ${result.success}`);
      console.log(`   system_info.version: ${result.system_info?.version}`);
      console.log(`   final_report 存在: ${!!result.final_report}`);
      console.log(`   image_analyses 数量: ${result.image_analyses?.length || 0}`);
      
      if (result.success && result.final_report) {
        console.log('📋 最终报告验证:');
        console.log(`   风险等级: ${result.final_report.risk_level}`);
        console.log(`   置信度: ${result.final_report.confidence_level}`);
        console.log(`   关键发现数量: ${Object.keys(result.final_report.key_findings || {}).length}`);
        
        setReport(result.final_report);
        console.log('✅ 报告已成功设置到状态中');
        console.log('🎉 异步分析流程完成！');
        
        // 切换到报告视图
        setPreDateView("report");
        
        // 重置任务状态为空闲
        setTimeout(() => {
          setTaskStatus({
            taskId: null,
            status: 'idle',
            progress: 0,
            currentStep: '',
            estimatedTime: ''
          });
        }, 2000); // 2秒后重置，让用户看到完成状态
        
      } else {
        console.error('❌ 响应中缺少分析报告');
        throw new Error('分析完成但结果不完整');
      }
      
    } catch (err) {
      console.error('❌ ===== 异步分析流程失败 =====');
      console.error('错误类型:', err.constructor.name);
      console.error('错误消息:', err.message);
      console.error('完整错误:', err);
      
      // 网络错误特别处理
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        setError('网络连接失败，请检查后端服务器是否正常运行');
      } else if (err.message.includes('HTTP 413')) {
        setError('文件过大，请压缩后重试（单个文件不超过10MB）');
      } else if (err.message.includes('HTTP 400')) {
        setError('请求格式错误，请检查输入数据');
      } else if (err.message.includes('超时')) {
        setError('分析任务超时，请稍后重试。如果问题持续，请联系技术支持。');
      } else {
        setError(err instanceof Error ? err.message : '生成报告时发生未知错误');
      }
    } finally {
      setIsGenerating(false);
      console.log('🔄 异步流程结束，已重置加载状态');
      
      // 确保在错误情况下也重置任务状态
      if (taskStatus.status !== 'completed') {
        setTimeout(() => {
          setTaskStatus({
            taskId: null,
            status: 'idle',
            progress: 0,
            currentStep: '',
            estimatedTime: ''
          });
        }, 3000); // 3秒后重置
      }
    }
  }

  const initialMessages: ChatMessage[] = [
    {
      id: "1",
      content: "您好！我是您的照妖镜 AI助理。约会结束后，我在这里帮助您处理和反思这次经历。请随时分享您的感受。",
      sender: "assistant",
      timestamp: "2:30 PM"
    }
  ]

  return (
    <div className={cn("min-h-screen bg-amber-50", className)}>
      <div className="container mx-auto px-4 py-6 max-w-md">
        {/* 标题区域 */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold text-black mb-2">捞男捞女"照妖镜"</h1>
        </div>

        {/* 标签页导航 */}
        <div className="bg-white border-2 border-black p-1 mb-6" style={{borderRadius: '4px'}}>
          <div className="flex">
          <button
              onClick={() => {
                setActiveTab("pre-date");
                // 切换到pre-date时重置视图状态
                setPreDateView("form");
              }}
            className={cn(
                "flex-1 py-3 px-4 text-sm font-bold transition-all border-2",
              activeTab === "pre-date"
                  ? "bg-amber-400 text-black border-black"
                  : "bg-white text-black border-transparent hover:border-black"
            )}
              style={{
                borderRadius: '4px',
                boxShadow: activeTab === "pre-date" ? '2px 2px 0px #000000' : 'none'
              }}
          >
              Pre-Date 预警
          </button>
          <button
            onClick={() => setActiveTab("post-date")}
            className={cn(
                "flex-1 py-3 px-4 text-sm font-bold transition-all border-2 ml-1",
              activeTab === "post-date"
                  ? "bg-amber-400 text-black border-black"
                  : "bg-white text-black border-transparent hover:border-black"
            )}
              style={{
                borderRadius: '4px',
                boxShadow: activeTab === "post-date" ? '2px 2px 0px #000000' : 'none'
              }}
          >
              Post-Date 复盘
          </button>
          </div>
        </div>

        {/* 标签页内容 */}
        <AnimatePresence mode="wait">
          {activeTab === "pre-date" && (
            <motion.div
              key="pre-date"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="bg-white p-6 border-2 border-black"
              style={{borderRadius: '4px', boxShadow: '4px 4px 0px #000000'}}
            >
              {/* 表单视图 */}
              {preDateView === "form" && (
                <>
              <div className="flex items-center space-x-2 mb-6">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    <h2 className="text-lg font-bold text-black">约会前安全扫描</h2>
              </div>

              <div className="space-y-6">
                {/* 基本信息输入 */}
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="nickname">昵称</Label>
                    <Input
                      id="nickname"
                      value={formData.nickname}
                      onChange={(e) => handleInputChange("nickname", e.target.value)}
                      placeholder="对方的昵称"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="profession">职业</Label>
                    <Input
                      id="profession"
                      value={formData.profession}
                      onChange={(e) => handleInputChange("profession", e.target.value)}
                      placeholder="对方的职业"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="age">年龄</Label>
                    <Input
                      id="age"
                      value={formData.age}
                      onChange={(e) => handleInputChange("age", e.target.value)}
                      placeholder="对方的年龄"
                    />
                  </div>
                </div>

                {/* 大的文本输入区域 */}
                <div className="space-y-2">
                  <Label htmlFor="bioOrChatHistory">对方的个人简介</Label>
                  <Textarea
                    id="bioOrChatHistory"
                    value={formData.bioOrChatHistory}
                    onChange={(e) => handleInputChange("bioOrChatHistory", e.target.value)}
                    placeholder="粘贴对方在交友平台上的个人简介、自我介绍等信息..."
                    className="min-h-[120px]"
                  />
                </div>

                {/* 文件上传 */}
                <div className="space-y-2">
                  <Label>上传聊天记录截图</Label>
                  <FileUpload 
                    onChange={handleFilesChange}
                    uploadedFiles={uploadedFiles}
                  />
                </div>

                {/* 错误提示 */}
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                    <div className="flex items-center space-x-2 text-red-600">
                      <AlertTriangle className="w-5 h-5" />
                      <span className="font-medium">错误</span>
                    </div>
                    <p className="text-red-700 text-sm mt-1">{error}</p>
                  </div>
                )}

                {/* 生成报告按钮 */}
                <Button
                  onClick={handleGenerateReport}
                  disabled={isGenerating}
                      className="w-full bg-amber-400 hover:bg-amber-400/80 disabled:bg-amber-400/30 disabled:cursor-not-allowed text-black py-4 font-bold transition-all border-2 border-black"
                      style={{borderRadius: '4px', boxShadow: '4px 4px 0px #000000'}}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      正在生成报告...
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-5 h-5 mr-2" />
                      生成警告报告
                    </>
                  )}
                </Button>

                    {/* 任务进度显示 */}
                    {taskStatus.status !== 'idle' && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="bg-amber-50 border-2 border-black rounded-xl p-4 space-y-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.8)]"
                      >
                        {/* 任务状态标题 */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            {taskStatus.status === 'creating' && <Clock className="w-4 h-4 text-amber-600" />}
                            {taskStatus.status === 'processing' && <Loader2 className="w-4 h-4 text-amber-600 animate-spin" />}
                            {taskStatus.status === 'completed' && <CheckCircle className="w-4 h-4 text-green-600" />}
                            {taskStatus.status === 'failed' && <AlertTriangle className="w-4 h-4 text-red-600" />}
                            <span className="text-sm font-medium text-amber-700">
                              {taskStatus.status === 'creating' && '创建任务'}
                              {taskStatus.status === 'processing' && '分析进行中'}
                              {taskStatus.status === 'completed' && '分析完成'}
                              {taskStatus.status === 'failed' && '分析失败'}
                            </span>
                          </div>
                          {taskStatus.taskId && (
                            <span className="text-xs text-amber-500 font-mono">
                              {taskStatus.taskId.substring(0, 8)}...
                            </span>
                          )}
                        </div>

                        {/* 进度条 */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-amber-600">{taskStatus.currentStep}</span>
                            <span className="text-sm font-medium text-amber-700">{taskStatus.progress}%</span>
                          </div>
                          <div className="w-full bg-amber-200 rounded-full h-2 overflow-hidden">
                            <motion.div
                              className={cn(
                                "h-full rounded-full transition-all duration-1000",
                                taskStatus.status === 'completed' ? "bg-green-500" :
                                taskStatus.status === 'failed' ? "bg-red-500" :
                                "bg-amber-500"
                              )}
                              initial={{ width: 0 }}
                              animate={{ width: `${taskStatus.progress}%` }}
                              transition={{ duration: 0.5, ease: "easeOut" }}
                    />
                  </div>
                        </div>

                        {/* 预计时间 */}
                        {taskStatus.estimatedTime && taskStatus.status === 'processing' && (
                          <div className="flex items-center space-x-2 text-xs text-amber-500">
                            <Clock className="w-3 h-3" />
                            <span>预计处理时间: {taskStatus.estimatedTime}</span>
                          </div>
                        )}

                        {/* 状态说明 */}
                        {taskStatus.status === 'processing' && (
                          <div className="text-xs text-amber-500">
                            AI正在智能分析您提供的信息，请耐心等待...
              </div>
                        )}
                        {taskStatus.status === 'completed' && (
                          <div className="text-xs text-green-600">
                            ✨ 分析完成！请查看下方的详细报告。
                          </div>
                        )}
                        {taskStatus.status === 'failed' && (
                          <div className="text-xs text-red-600">
                            ❌ 分析失败，请检查网络连接后重试。
                          </div>
                        )}
                      </motion.div>
                    )}
                  </div>
                </>
              )}

              {/* 报告视图 */}
              {preDateView === "report" && report && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {/* 报告内容 */}
                  <ReportDisplay 
                    report={report} 
                    onBackToForm={handleBackToForm}
                    className="border-0 shadow-none bg-transparent p-0"
                  />
                </motion.div>
              )}
            </motion.div>
          )}

          {activeTab === "post-date" && (
            <motion.div
              key="post-date"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="bg-white border-2 border-black h-[600px] rounded-md shadow-[4px_4px_0px_0px_rgba(0,0,0,0.8)]"
            >
              <ChatInterface 
                messages={initialMessages}
                onSendMessage={(message) => console.log("发送消息:", message)}
                className="h-full"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

export default EmotionalSafetyApp 