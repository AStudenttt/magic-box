'use client';
import { useState, useRef } from 'react';
import { 
  Upload, X, Scissors, Download, Copy, Image as ImageIcon, Trash2, Zap, 
  FileText, FileType, ScanText, ChevronRight, Eraser, PenTool, Undo 
} from 'lucide-react';
import ReactCrop, { type Crop, type PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

// === 1. 配置常量 (已移除画质超清) ===
const TOOLS = [
  { id: 'remove-bg', icon: ImageIcon, label: '智能抠图工坊', desc: '上传图片，AI 自动移除背景', color: 'orange' },
  { id: 'pdf-to-word', icon: FileType, label: 'PDF 转 Word', desc: '精准还原文档格式，可编辑', color: 'blue' },
  { id: 'ocr', icon: ScanText, label: '截图转文字', desc: '截图、照片转文字，一键复制', color: 'emerald' },
  { id: 'eraser', icon: Eraser, label: '魔法消除笔', desc: '涂抹杂物，一键消失', color: 'fuchsia' },
] as const;

type ToolType = typeof TOOLS[number]['id'];

// === 类型定义 ===
interface TaskItem {
  id: string;
  file: File;
  previewUrl?: string;
  status: 'pending' | 'processing' | 'success' | 'error';
  resultUrl?: string; 
  resultText?: string; 
  resultFileName?: string;
  bgColor?: string;
}

// === 辅助函数 ===
function centerAspectCrop(mediaWidth: number, mediaHeight: number, aspect: number) { return centerCrop(makeAspectCrop({ unit: '%', width: 90 }, aspect, mediaWidth, mediaHeight), mediaWidth, mediaHeight) }
const getCroppedImg = async (imageSrc: string, pixelCrop: PixelCrop, originalFileName: string): Promise<File | null> => {
  const image = new Image(); image.src = imageSrc; await new Promise((resolve) => { image.onload = resolve; });
  const canvas = document.createElement('canvas'); canvas.width = pixelCrop.width; canvas.height = pixelCrop.height;
  const ctx = canvas.getContext('2d'); if (!ctx) return null;
  ctx.drawImage(image, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, pixelCrop.width, pixelCrop.height);
  return new Promise((resolve) => { canvas.toBlob((blob) => { resolve(blob ? new File([blob], `cropped_${originalFileName}`, { type: 'image/jpeg' }) : null); }, 'image/jpeg'); });
};

export default function Home() {
  const [currentTool, setCurrentTool] = useState<ToolType>('remove-bg');
  const [queue, setQueue] = useState<TaskItem[]>([]);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 裁剪与消除状态
  const [cropTask, setCropTask] = useState<TaskItem | null>(null);
  const [eraserTask, setEraserTask] = useState<TaskItem | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  
  // 画笔状态
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(20);

  // 获取当前工具的配置对象
  const activeToolConfig = TOOLS.find(t => t.id === currentTool)!;

  // === 核心逻辑 ===
  const processFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const newTasks: TaskItem[] = Array.from(files).map((file) => ({
      id: Math.random().toString(36).substr(2, 9),
      file: file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      status: 'pending',
      bgColor: 'transparent'
    }));
    setQueue((prev) => [...prev, ...newTasks]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { processFiles(e.target.files); };

  const processQueue = async () => {
    if (currentTool === 'eraser') { alert("请点击图片下方的【✏️ 去消除】按钮开始涂抹！"); return; }
    if (queue.filter(t => t.status === 'pending').length === 0) return;
    setIsProcessingBatch(true);
    const currentQueue = [...queue];

    for (let i = 0; i < currentQueue.length; i++) {
      const task = currentQueue[i];
      if (task.status !== 'pending') continue;
      updateTaskStatus(task.id, 'processing');
      const formData = new FormData();
      formData.append('file', task.file);

      // API 路由逻辑精简
      let apiUrl = `http://localhost:8000/api/${currentTool === 'pdf-to-word' ? 'pdf-to-word' : currentTool === 'ocr' ? 'ocr' : 'remove-bg'}`;

      try {
        const res = await fetch(apiUrl, { method: 'POST', body: formData });
        if (res.ok) {
          if (currentTool === 'ocr') {
            const data = await res.json();
            updateTaskStatus(task.id, 'success', undefined, undefined, data.text);
          } else {
            const blob = await res.blob();
            let prefix = currentTool === 'remove-bg' ? 'koukou_' : 'processed_';
            let ext = currentTool === 'pdf-to-word' ? '.docx' : '.png';
            let resultName = `${prefix}${task.file.name.split('.')[0]}${ext}`;
            updateTaskStatus(task.id, 'success', URL.createObjectURL(blob), resultName);
          }
        } else {
          updateTaskStatus(task.id, 'error');
        }
      } catch (error) {
        console.error(error); updateTaskStatus(task.id, 'error');
      }
    }
    setIsProcessingBatch(false);
  };

  const runEraser = async () => {
    if (!eraserTask || !canvasRef.current) return;
    const maskBlob = await new Promise<Blob | null>(resolve => canvasRef.current!.toBlob(resolve, 'image/png'));
    if (!maskBlob) return;
    const formData = new FormData();
    formData.append('image', eraserTask.file);
    formData.append('mask', maskBlob);
    
    updateTaskStatus(eraserTask.id, 'processing');
    setEraserTask(null);

    try {
        const res = await fetch('http://localhost:8000/api/magic-eraser', { method: 'POST', body: formData });
        if (res.ok) {
            const blob = await res.blob();
            updateTaskStatus(eraserTask.id, 'success', URL.createObjectURL(blob), `erased_${eraserTask.file.name}`);
        } else {
            updateTaskStatus(eraserTask.id, 'error');
        }
    } catch (e) {
        console.error(e); updateTaskStatus(eraserTask.id, 'error');
    }
  };

  const updateTaskStatus = (id: string, status: TaskItem['status'], resultUrl?: string, resultFileName?: string, resultText?: string) => {
    setQueue((prev) => prev.map(t => t.id === id ? { ...t, status, resultUrl, resultFileName, resultText } : t));
  };
  const updateTaskBg = (id: string, color: string) => { setQueue((prev) => prev.map(t => t.id === id ? { ...t, bgColor: color } : t)); };
  const removeTask = (id: string) => setQueue((prev) => prev.filter((t) => t.id !== id));
  
  const openCropModal = (task: TaskItem) => { setCropTask(task); setAspect(undefined); setCrop(undefined); setCompletedCrop(undefined); };
  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) { const { width, height } = e.currentTarget; setCrop(centerAspectCrop(width, height, aspect || width / height)); }
  const handleAspectClick = (newAspect: number | undefined) => { setAspect(newAspect); if (imgRef.current && newAspect) { const { width, height } = imgRef.current; setCrop(centerAspectCrop(width, height, newAspect)); } };
  const saveCroppedImage = async () => { if (!cropTask || !imgRef.current || !completedCrop?.width || !cropTask.previewUrl) return; try { const cf = await getCroppedImg(cropTask.previewUrl, completedCrop!, cropTask.file.name); if(cf) { setQueue(prev=>prev.map(t=>t.id===cropTask.id?{...t, file:cf, previewUrl:URL.createObjectURL(cf), status:'pending'}:t)); setCropTask(null); } } catch(e){alert('裁剪失败');} };
  
  const switchTool = (tool: ToolType) => { 
    if (queue.length > 0 && !confirm("切换工具会清空当前任务列表，确定吗？")) return; 
    setQueue([]); setCurrentTool(tool); 
  };

  // 画板逻辑
  const startDrawing = (e: React.MouseEvent) => { setIsDrawing(true); draw(e); };
  const stopDrawing = () => { setIsDrawing(false); (canvasRef.current as any).ctx?.beginPath(); };
  const draw = (e: React.MouseEvent) => {
      if (!isDrawing || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'white';
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y);
  };
  const initCanvas = (img: HTMLImageElement) => {
      if (!canvasRef.current) return;
      const canvas = canvasRef.current;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) { ctx.fillStyle = 'black'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  };
  const downloadWithBackground = async (task: TaskItem) => {
    if (!task.resultUrl) return;
    if (currentTool !== 'remove-bg' || !task.bgColor || task.bgColor === 'transparent') {
      const a = document.createElement('a'); a.href = task.resultUrl; a.download = task.resultFileName || `processed_${task.file.name}`; a.click(); return;
    }
    const image = new Image(); image.src = task.resultUrl; image.crossOrigin = "anonymous"; await new Promise((resolve) => { image.onload = resolve; });
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = task.bgColor; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0);
    const link = document.createElement('a'); link.download = `id_photo_${task.file.name.split('.')[0]}.jpg`; link.href = canvas.toDataURL('image/jpeg', 1.0); link.click();
  };

  return (
    <div className="flex h-screen bg-[#f8fafc] font-sans text-slate-800 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shadow-sm z-20 shrink-0">
        <div className="p-6 flex items-center gap-3 border-b border-slate-100">
          <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center text-white font-black text-lg">扣</div>
          <span className="font-bold text-xl tracking-tight text-slate-900">扣扣我的</span>
        </div>
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {TOOLS.map((tool) => (
            <button 
              key={tool.id}
              onClick={() => switchTool(tool.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium border
                ${currentTool === tool.id 
                  ? `bg-${tool.color}-50 text-${tool.color}-700 border-${tool.color}-200 shadow-sm` 
                  : 'text-slate-500 border-transparent hover:bg-slate-50'
                }`}
            >
              <tool.icon size={20} className={currentTool === tool.id ? `text-${tool.color}-500` : 'text-slate-400'}/> 
              {tool.label}
              {currentTool === tool.id && <ChevronRight size={16} className={`ml-auto text-${tool.color}-400`}/>}
            </button>
          ))}
        </nav>
        <div className="p-6 border-t border-slate-100 text-xs text-slate-400 text-center">本地离线运行 · 数据安全</div>
      </aside>

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-slate-50">
        <div className="absolute inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:20px_20px] -z-10 opacity-50"></div>
        
        <header className="px-8 py-6 flex justify-between items-center bg-white/80 backdrop-blur-sm border-b border-slate-200 shrink-0">
          <div>
             <h1 className="text-2xl font-black text-slate-900 flex items-center gap-3">
               <activeToolConfig.icon className={`text-${activeToolConfig.color}-600`} size={32} />
               {activeToolConfig.label}
             </h1>
             <p className="text-slate-500 text-sm mt-1">{activeToolConfig.desc}</p>
          </div>
          {queue.length > 0 && currentTool !== 'eraser' && (
             <div className="flex gap-3">
                 <button onClick={() => setQueue([])} className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-red-500 transition-colors">清空</button>
                 <button onClick={processQueue} disabled={isProcessingBatch} className={`px-6 py-2.5 rounded-lg text-white font-bold shadow-lg transition-all active:scale-95 flex items-center gap-2 bg-${activeToolConfig.color}-500 hover:bg-${activeToolConfig.color}-600 ${isProcessingBatch ? 'opacity-50 cursor-not-allowed' : ''}`}>
                   {isProcessingBatch ? <Zap className="animate-spin" size={18}/> : <Zap size={18}/>}
                   {isProcessingBatch ? '处理中...' : '开始执行'}
                 </button>
             </div>
          )}
        </header>

        <div className="flex-1 overflow-y-scroll p-8 scroll-smooth">
          <div className="max-w-5xl mx-auto space-y-8">
             <div onClick={() => fileInputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }} onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }} onDrop={(e) => { e.preventDefault(); setIsDragging(false); processFiles(e.dataTransfer.files); }} className={`group cursor-pointer border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-300 ${isDragging ? `border-${activeToolConfig.color}-200 bg-${activeToolConfig.color}-50 scale-[1.01]` : 'border-slate-300 hover:border-slate-400 hover:bg-white bg-white/50'}`}>
                <input ref={fileInputRef} type="file" multiple accept={currentTool === 'pdf-to-word' ? ".pdf" : "image/*"} onChange={handleFileChange} className="hidden" />
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white mx-auto mb-4 shadow-lg transition-transform group-hover:scale-110 bg-${activeToolConfig.color}-500`}><Upload size={24}/></div>
                <h3 className="font-bold text-lg text-slate-700">点击或拖拽文件到这里</h3>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
               {queue.map((task) => (
                 <div key={task.id} className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col h-[320px] animate-fade-in-up">
                    <div className="px-4 py-3 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
                        <div className="flex items-center gap-2 overflow-hidden"><div className={`w-2 h-2 rounded-full ${task.status === 'success' ? 'bg-green-500' : task.status === 'processing' ? 'bg-orange-500 animate-pulse' : task.status === 'error' ? 'bg-red-500' : 'bg-slate-300'}`}></div><span className="text-xs font-bold text-slate-600 truncate max-w-[150px]">{task.file.name}</span></div>
                        <button onClick={() => removeTask(task.id)} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={16}/></button>
                    </div>
                    <div className="flex-1 flex overflow-hidden relative">
                        <div className="w-1/2 p-4 flex items-center justify-center border-r border-slate-100 bg-slate-50/30 relative group">
                            {task.previewUrl ? <img src={task.previewUrl} className="max-w-full max-h-full object-contain shadow-sm" /> : <FileText size={48} className="text-slate-300"/>}
                            {currentTool !== 'pdf-to-word' && task.status === 'pending' && currentTool !== 'eraser' && (<button onClick={() => openCropModal(task)} className="absolute bottom-3 right-3 p-2 bg-white rounded-lg shadow border border-slate-200 opacity-0 group-hover:opacity-100 transition-opacity hover:text-orange-500"><Scissors size={16}/></button>)}
                            {currentTool === 'eraser' && task.status === 'pending' && (<button onClick={() => setEraserTask(task)} className="absolute bottom-3 right-3 px-3 py-1.5 bg-fuchsia-500 text-white rounded-lg shadow-lg font-bold flex items-center gap-1 hover:bg-fuchsia-600 transition-colors"><PenTool size={14}/> 去消除</button>)}
                        </div>
                        <div className="w-1/2 p-4 flex flex-col items-center justify-center relative bg-[url('https://media.istockphoto.com/id/1146261314/vector/checker-seamless-pattern-vector-transparent-grid-background.jpg?s=612x612&w=0&k=20&c=d58dGg0i2b7gK7i28x8G8e8i8x8G8e8i8x8G8e8i8x8=')]">
                           {currentTool === 'remove-bg' && task.bgColor && task.bgColor !== 'transparent' && <div className="absolute inset-0" style={{ background: task.bgColor }}></div>}
                           {task.status === 'success' ? (
                               currentTool === 'ocr' ? (<div className="absolute inset-0 bg-white p-3 overflow-auto"><p className="text-xs text-slate-600 font-mono whitespace-pre-wrap">{task.resultText}</p></div>) : 
                               task.resultUrl ? (currentTool === 'remove-bg' || currentTool === 'eraser' ? <img src={task.resultUrl} className="max-w-full max-h-full object-contain relative z-10" /> : <div className="bg-white p-4 rounded-xl shadow-sm border border-blue-100 text-center relative z-10"><FileText size={32} className="text-blue-500 mx-auto mb-2"/><span className="text-xs font-bold text-blue-600 block">转换完成</span></div>) : null
                           ) : (<div className="bg-white/90 backdrop-blur px-3 py-1.5 rounded-full text-xs font-bold text-slate-400 border border-slate-200 z-10 shadow-sm">{task.status === 'processing' ? '处理中...' : '等待开始'}</div>)}
                        </div>
                    </div>
                    {task.status === 'success' && (
                        <div className="px-4 py-3 bg-white border-t border-slate-100 flex justify-between items-center gap-2">
                             {currentTool === 'remove-bg' ? (<div className="flex gap-1.5">{['transparent', '#ffffff', '#3b82f6', '#ef4444'].map(c => (<button key={c} onClick={()=>updateTaskBg(task.id, c)} className={`w-5 h-5 rounded-full border border-slate-200 hover:scale-110 transition-transform ${c==='transparent'?"bg-[url('https://media.istockphoto.com/id/1146261314/vector/checker-seamless-pattern-vector-transparent-grid-background.jpg?s=612x612&w=0&k=20&c=d58dGg0i2b7gK7i28x8G8e8i8x8G8e8i8x8G8e8i8x8=')]":""}`} style={c!=='transparent'?{background:c}:{}}></button>))}</div>) : <div></div>}
                             <div className="flex gap-2">
                                 {currentTool === 'ocr' ? (<button onClick={() => copyText(task.resultText || '')} className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-emerald-600 px-2 py-1 rounded hover:bg-slate-50"><Copy size={14}/> 复制</button>) : (<button onClick={() => downloadWithBackground(task)} className={`flex items-center gap-1 text-xs font-bold text-white px-3 py-1.5 rounded-lg shadow-sm transition-all hover:shadow-md active:scale-95 bg-${activeToolConfig.color}-500 hover:bg-${activeToolConfig.color}-600`}><Download size={14}/> 下载</button>)}
                             </div>
                        </div>
                    )}
                 </div>
               ))}
             </div>
          </div>
        </div>
      </main>

      {/* Crop Modal */}
      {cropTask && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/95 backdrop-blur-sm animate-fade-in p-6"><div className="bg-white w-full max-w-5xl h-[85vh] rounded-2xl overflow-hidden shadow-2xl flex flex-col"><div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50"><h3 className="font-bold text-lg flex items-center gap-2"><Scissors size={20}/> 裁剪图片</h3><button onClick={() => setCropTask(null)} className="p-2 hover:bg-slate-200 rounded-full"><X size={20}/></button></div><div className="flex-1 bg-slate-950 overflow-auto flex items-center justify-center p-8"><ReactCrop crop={crop} onChange={(_, p) => setCrop(p)} onComplete={(c) => setCompletedCrop(c)} aspect={aspect}><img ref={imgRef} src={cropTask.previewUrl} onLoad={onImageLoad} style={{ maxHeight: '60vh', objectFit: 'contain' }} /></ReactCrop></div><div className="p-6 border-t border-slate-200 bg-white flex justify-between items-center"><div className="flex gap-2">{[undefined, 1, 16/9, 4/3].map((r, i) => (<button key={i} onClick={()=>handleAspectClick(r)} className={`px-4 py-2 text-sm font-bold border rounded-lg ${aspect===r ? 'bg-slate-900 text-white border-slate-900' : 'text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{r === undefined ? '自由' : r === 1 ? '1:1' : r === 16/9 ? '16:9' : '4:3'}</button>))}</div><div className="flex gap-3"><button onClick={() => setCropTask(null)} className="px-6 py-2.5 font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors">取消</button><button onClick={saveCroppedImage} className="px-6 py-2.5 font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-lg transition-transform active:scale-95">确认裁剪</button></div></div></div></div>)}

      {/* Eraser Modal */}
      {eraserTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/95 backdrop-blur-sm animate-fade-in p-6">
          <div className="bg-white w-full max-w-5xl h-[85vh] rounded-2xl overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
               <h3 className="font-bold text-lg flex items-center gap-2 text-fuchsia-700"><Eraser size={20}/> 魔法消除笔</h3>
               <button onClick={() => setEraserTask(null)} className="p-2 hover:bg-slate-200 rounded-full"><X size={20}/></button>
            </div>
            <div className="flex-1 bg-slate-900 overflow-auto flex items-center justify-center p-8 relative cursor-crosshair">
                <div className="relative shadow-2xl">
                    <img src={eraserTask.previewUrl} className="max-h-[60vh] object-contain pointer-events-none" onLoad={(e) => initCanvas(e.currentTarget)} />
                    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-50" onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing} />
                </div>
            </div>
            <div className="p-6 border-t border-slate-200 bg-white flex justify-between items-center">
               <div className="flex items-center gap-4"><span className="text-sm font-bold text-slate-500">笔刷大小</span><input type="range" min="5" max="50" value={brushSize} onChange={(e)=>setBrushSize(Number(e.target.value))} className="w-32 accent-fuchsia-500"/><button onClick={() => initCanvas(document.querySelector('img[src="'+eraserTask.previewUrl+'"]') as HTMLImageElement)} className="ml-4 flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-red-500"><Undo size={14}/> 重置画布</button></div>
               <div className="flex gap-3"><button onClick={() => setEraserTask(null)} className="px-6 py-2.5 font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors">取消</button><button onClick={runEraser} className="px-6 py-2.5 font-bold text-white bg-fuchsia-500 hover:bg-fuchsia-600 rounded-xl shadow-lg transition-transform active:scale-95 flex items-center gap-2"><Zap size={18}/> 开始消除</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}