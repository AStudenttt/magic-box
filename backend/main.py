import os
import io
import shutil
import numpy as np
import cv2
from fastapi import FastAPI, UploadFile, File, BackgroundTasks, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from rembg import remove
from PIL import Image
from pdf2docx import Converter

app = FastAPI()

# 懒加载变量
ocr_reader = None 

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def remove_file(path: str):
    try: os.remove(path)
    except: pass

def get_ocr_reader():
    global ocr_reader
    if ocr_reader is None:
        import easyocr
        ocr_reader = easyocr.Reader(['ch_sim', 'en'], gpu=False)
    return ocr_reader

@app.get("/")
def read_root(): return {"status": "AI Toolbox is Ready!"}

# 1. 抠图
@app.post("/api/remove-bg")
async def remove_bg(file: UploadFile = File(...)):
    print("正在执行抠图...")
    image_data = await file.read()
    output_image = remove(Image.open(io.BytesIO(image_data)))
    img_byte_arr = io.BytesIO()
    output_image.save(img_byte_arr, format='PNG')
    img_byte_arr.seek(0)
    return StreamingResponse(img_byte_arr, media_type="image/png")

# 2. PDF转Word
@app.post("/api/pdf-to-word")
async def pdf_to_word(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    print("正在转换PDF...")
    if not os.path.exists("temp"): os.makedirs("temp")
    input_f = f"temp/{file.filename}"
    output_f = f"temp/{file.filename.rsplit('.', 1)[0]}.docx"
    with open(input_f, "wb") as buffer: shutil.copyfileobj(file.file, buffer)
    try:
        cv = Converter(input_f)
        cv.convert(output_f, start=0, end=None)
        cv.close()
        background_tasks.add_task(remove_file, input_f)
        background_tasks.add_task(remove_file, output_f)
        return FileResponse(output_f, filename=os.path.basename(output_f), media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    except Exception as e: return {"error": str(e)}

# 3. OCR
@app.post("/api/ocr")
async def ocr_image(file: UploadFile = File(...)):
    print("正在识别文字...")
    try:
        reader = get_ocr_reader()
        image = Image.open(io.BytesIO(await file.read()))
        result = reader.readtext(np.array(image), detail=0)
        return JSONResponse(content={"text": "\n".join(result)})
    except Exception as e:
        print(f"OCR Error: {e}")
        return JSONResponse(content={"text": "识别失败，请检查是否安装了easyocr模型"}, status_code=500)

# === 4. 新功能：魔法消除 (Inpainting) ===
@app.post("/api/magic-eraser")
async def magic_eraser(image: UploadFile = File(...), mask: UploadFile = File(...)):
    print("正在进行魔法消除...")
    
    # 1. 读取原图
    img_bytes = await image.read()
    nparr_img = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr_img, cv2.IMREAD_COLOR)

    # 2. 读取蒙版 (Mask)
    # 前端传来的蒙版是黑底白字的图片，白色代表要消除的区域
    mask_bytes = await mask.read()
    nparr_mask = np.frombuffer(mask_bytes, np.uint8)
    mask_img = cv2.imdecode(nparr_mask, cv2.IMREAD_GRAYSCALE)

    # 3. 确保 mask 和 img 尺寸一致 (防止前端缩放导致的误差)
    mask_img = cv2.resize(mask_img, (img.shape[1], img.shape[0]))

    # 4. 核心算法：Telea 修复算法 (基于邻域像素修补)
    # 3 是修复半径，半径越小细节越好，半径越大适合大面积修复
    result = cv2.inpaint(img, mask_img, 3, cv2.INPAINT_TELEA)

    # 5. 返回结果
    _, encoded_img = cv2.imencode('.png', result)
    return StreamingResponse(io.BytesIO(encoded_img.tobytes()), media_type="image/png")

if __name__ == "__main__":
    import uvicorn
    print("正在启动服务...") 
    uvicorn.run(app, host="0.0.0.0", port=8000)