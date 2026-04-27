import sys
import os
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

# 把原有的 src 目录加入运行环境，复用数学核心能力
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))
from egm_core import EGMModel

app = FastAPI(
    title="EGM 几何模型计算引擎 API",
    description="提供结构化的 EGM 计算服务，不仅供自研前端调用，更可作为原生功能供 AI Agent/大语言模型集成。",
    version="1.0.0"
)

# 允许跨域，方便开发阶段前端本地调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class EGMParams(BaseModel):
    """
    接收来自 AI Agent 或者是图形界面的请求参数
    """
    I_current: float = 10.0  # 雷电流
    h_o: float = 10.0        # 地物抬升高度
    side: str = "left"       # 观测侧
    
    # 以下为高级工程参数，若为空则自动使用默认值
    h_s: Optional[float] = None
    x_s: Optional[float] = None
    U_max: Optional[float] = None
    left_ground_tilt_deg: Optional[float] = None
    right_ground_tilt_deg: Optional[float] = None
    phase_x_positions: Optional[List[float]] = None
    phase_heights: Optional[List[float]] = None
    phase_average_heights: Optional[List[float]] = None

@app.post("/api/v1/egm/calculate_state", summary="计算模型当前几何状态")
def calculate_state(params: EGMParams):
    """
    计算特定雷电流、地物高度下的所有动态掩码点、击距坐标。
    这也是新版专业前端最主要的绘图数据来源。
    """
    model = EGMModel()
    
    # 动态应用可能传来的高级参数
    model.update_parameters(
        h_s=params.h_s,
        x_s=params.x_s,
        U_max=params.U_max,
        left_ground_tilt_deg=params.left_ground_tilt_deg,
        right_ground_tilt_deg=params.right_ground_tilt_deg,
        phase_x_positions=params.phase_x_positions,
        phase_heights=params.phase_heights,
        phase_average_heights=params.phase_average_heights,
    )
    
    # 只需要生成较少的点即可满足前端平滑绘制需求（500个足够了）
    theta = np.linspace(0, 2 * np.pi, 500)
    state = model.build_state(params.I_current, params.h_o, theta, side=params.side)
    
    # 组织出精简友好的 JSON 响应体
    phase_states_json = []
    total_exposure = False
    
    for ps in state["phase_states"]:
        mask_list = ps.mask.tolist()
        has_exposure = any(mask_list)
        if has_exposure:
            total_exposure = True
            
        phase_states_json.append({
            "name": ps.definition.name,
            "color": ps.definition.color,
            "x": float(ps.definition.x),
            "h": ps.definition.h,
            "rc": float(ps.rc),
            "rg": float(ps.rg),
            "exposed_length": float(ps.exposed_length),
            "has_exposure": has_exposure,
            # 将绘图轨迹转为 List
            "x_rc": ps.x_rc.tolist(),
            "y_rc": ps.y_rc.tolist(),
            "protection_y": ps.protection_y.tolist(),
            "mask": mask_list
        })
        
    return {
        "summary": {
            "side": params.side,
            "rs": float(state["rs"]),
            "shield_center_x": float(state["shield_center_x"]),
            "h_s": float(model.h_s),
            "total_exposure": total_exposure
        },
        "bounds": state["bounds"],
        "phases": phase_states_json
    }

@app.post("/api/v1/egm/max_backflash", summary="检索最大绕击雷电流")
def find_max_backflash(params: EGMParams):
    """
    供大语言模型（Agent）专门分析绕击瓶颈所设计的 API。
    只要提供地物高度和考察侧面以及定制化工程参数，直接返回安全的电流阈值边界。
    """
    model = EGMModel()
    
    model.update_parameters(
        h_s=params.h_s,
        x_s=params.x_s,
        U_max=params.U_max,
        left_ground_tilt_deg=params.left_ground_tilt_deg,
        right_ground_tilt_deg=params.right_ground_tilt_deg,
        phase_x_positions=params.phase_x_positions,
        phase_heights=params.phase_heights,
        phase_average_heights=params.phase_average_heights,
    )
    
    theta = np.linspace(0, 2 * np.pi, 200) # 搜索时可以粗略计算，加快速度
    max_I_current = model.find_max_backflash_current(params.h_o, theta, side=params.side)
    
    return {
        "h_o": params.h_o,
        "side": params.side,
        "max_backflash_current": max_I_current,
        "message": f"在 {'左' if params.side == 'left' else '右'} 侧、地物高度 {params.h_o}m 情况下，完全屏蔽的最大击雷电流为 {max_I_current} kA。" if max_I_current else "当前配置下存在无法完全屏蔽的风险。"
    }
