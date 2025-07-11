import React from "react"
import { motion } from "framer-motion"
import { cn } from "../lib/utils"
import { 
  X,
  ArrowLeft,
  FileText,
  MessageCircle,
  Camera,
  Lightbulb,
  Target
} from "lucide-react"

interface ReportData {
  risk_level: string
  key_findings: {
    [key: string]: any
  }
  final_suggestion: string
  confidence_level: string
  professional_insight?: string
}

interface ReportDisplayProps {
  report: ReportData
  onClose?: () => void
  onBackToForm?: () => void
  className?: string
}

const ReportDisplay: React.FC<ReportDisplayProps> = ({ report, onClose, onBackToForm, className }) => {
  const getRiskLevelColor = (level: string) => {
    switch (level) {
      case "低风险":
        return "text-green-700"
      case "中等风险":
        return "text-orange-600"
      case "高风险":
        return "text-red-600"
      default:
        return "text-gray-700"
    }
  }

  const getRiskDotColor = (level: string) => {
    switch (level) {
      case "低风险":
        return "bg-green-500"
      case "中等风险":
        return "bg-orange-500"
      case "高风险":
        return "bg-red-500"
      default:
        return "bg-gray-500"
    }
  }

  const getRiskBorderColor = (level: string) => {
    switch (level) {
      case "低风险":
        return "border-l-green-500"
      case "中等风险":
        return "border-l-orange-500"
      case "高风险":
        return "border-l-red-500"
      default:
        return "border-l-gray-500"
    }
  }

  // 分析类型映射 - 使用Lucide图标替代emoji
  const analysisTypeMap = {
    bio_analysis: { 
      title: "个人简介分析", 
      icon: <FileText className="w-5 h-5" />, 
      color: "bg-amber-100 border-amber-500" 
    },
    chat_analysis: { 
      title: "聊天记录分析", 
      icon: <MessageCircle className="w-5 h-5" />, 
      color: "bg-amber-100 border-amber-500" 
    },
    photo_analysis: { 
      title: "生活照分析", 
      icon: <Camera className="w-5 h-5" />, 
      color: "bg-amber-100 border-amber-500" 
    }
  } as const

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className={cn(
        "bg-white border-2 border-black overflow-hidden shadow-[4px_4px_0px_0px_rgba(0,0,0,0.8)]", 
        className
      )}
    >
      {/* 报告头部 */}
      <div className="border-b-2 border-black p-6 bg-amber-400">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div>
              <h2 className="text-2xl font-bold text-black">AI安全分析报告</h2>
              <div className="flex items-center space-x-3 mt-2">
                <div className={cn(
                  "w-3 h-3 rounded-full border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,0.8)]", 
                  getRiskDotColor(report.risk_level)
                )}></div>
                <span className={cn(
                  "text-base font-bold px-2 py-1 bg-white border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,0.8)]", 
                  getRiskLevelColor(report.risk_level)
                )}>
                  {report.risk_level}
                </span>
              </div>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="w-8 h-8 bg-white border-2 border-black hover:bg-amber-100 flex items-center justify-center font-bold text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,0.8)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 报告内容 */}
      <div className="p-6 space-y-6 bg-white">
        {/* 关键发现 - 动态条件显示 */}
        <div className="space-y-6">
          
          {Object.entries(report.key_findings).map(([key, analysis], index) => {
            if (!analysis) return null // 只显示存在的分析类型
            
            const analysisType = analysisTypeMap[key as keyof typeof analysisTypeMap]
            if (!analysisType) return null

            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="space-y-3"
              >
                <div className="flex items-center gap-2">
                  <div className="bg-amber-200 w-8 h-8 flex items-center justify-center border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,0.8)]">
                    {analysisType.icon}
                  </div>
                  <h4 className="font-bold">{analysisType.title}</h4>
                </div>
                
                <div className={cn(
                  "bg-white border-2 border-black p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.8)]",
                  getRiskBorderColor(report.risk_level),
                  "border-l-4"
                )}>
                  <p className="text-black leading-relaxed font-medium">{analysis}</p>
                </div>
              </motion.div>
            )
          })}
        </div>

        <div className="border-b-2 border-dashed border-black/30" />

        {/* 专业建议 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="bg-amber-300 w-8 h-8 flex items-center justify-center border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,0.8)]">
              <Lightbulb className="w-5 h-5" />
            </div>
            <h3 className="text-xl font-bold text-black">专业建议</h3>
          </div>
          
          <div className="bg-amber-50 border-2 border-black p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.8)] border-l-4 border-l-amber-500">
            <p className="text-black leading-relaxed font-medium">{report.final_suggestion}</p>
          </div>
        </div>

        {/* 专业洞察（如果存在） */}
        {report.professional_insight && (
          <>
            <div className="border-b-2 border-dashed border-black/30" />
            
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="bg-amber-300 w-8 h-8 flex items-center justify-center border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,0.8)]">
                  <Target className="w-5 h-5" />
                </div>
                <h3 className="text-xl font-bold text-black">专业洞察</h3>
              </div>
              
              <div className="bg-amber-100 border-2 border-black p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.8)] border-l-4 border-l-amber-600">
                <p className="text-black leading-relaxed font-medium">{report.professional_insight}</p>
              </div>
            </div>
          </>
        )}

        {/* 返回按钮 */}
        {onBackToForm && (
          <div className="flex justify-center pt-6 mt-8 border-t-2 border-black">
            <button
              onClick={onBackToForm}
              className="bg-amber-400 hover:bg-amber-500 text-black font-bold px-6 py-3 border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,0.8)] transition-all hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,0.8)] hover:translate-x-[-1px] hover:translate-y-[-1px] flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              返回重新扫描
            </button>
          </div>
        )}
      </div>
    </motion.div>
  )
}

export default ReportDisplay 