from dataclasses import dataclass, field

import numpy as np


@dataclass(frozen=True)
class PhaseDefinition:
    """相位静态参数。"""

    # 相位编号、名称、坐标和颜色等基础参数
    id: int
    name: str
    x: float
    h: float
    h_av: float
    color: str
    u: float


@dataclass
class PhaseState:
    """某一相在特定工况下的计算结果。"""

    # 该相的静态定义
    definition: PhaseDefinition
    # 计算得到的导线击距和大地击距
    rc: float
    rg: float
    # 圆周轨迹、暴露掩码和暴露弧长
    x_rc: np.ndarray = field(default_factory=lambda: np.array([]))
    y_rc: np.ndarray = field(default_factory=lambda: np.array([]))
    terrain_y: np.ndarray = field(default_factory=lambda: np.array([]))
    protection_y: np.ndarray = field(default_factory=lambda: np.array([]))
    mask: np.ndarray = field(default_factory=lambda: np.array([], dtype=bool))
    exposed_length: float = 0.0
    ground_limit: float = 0.0


class EGMModel:
    """EGM 核心参数与几何计算模块。"""

    def __init__(self):
        # ============================
        # 这里是最常改的工程参数
        # ============================
        # 地线高度、地线横坐标和系统电压
        self.h_s = 54.0
        self.x_s = -2.05
        self.U_max = 500 * np.sqrt(2) / np.sqrt(3)
        # 左/右地面坡角（度），正值表示地面向外抬升
        self.left_ground_tilt_deg = 0.0
        self.right_ground_tilt_deg = 0.0

        # ============================
        # 三相导线可修改参数区
        # 你后面如果要调线路位置，优先改这里
        # ============================
        # 三相名称
        self.phase_names = ["A相", "B相", "C相"]
        # 三相横坐标（单位：m）
        self.phase_x_positions = [-3.4, -4.2, -3.4]
        # 三相导线高度（单位：m）
        self.phase_heights = [44.7, 40.8, 36.8]
        # 三相导线对地平均高度（单位：m）
        self.phase_average_heights = [37.43, 33.47, 29.47]
        # 三相颜色
        self.phase_colors = ["#e74c3c", "#2ecc71", "#3498db"]
        # 三相工作电压（中相、下相为负半波）
        self.phase_voltages = [self.U_max, -self.U_max / 2, -self.U_max / 2]

        # 根据上面的参数列表统一生成相定义，前端直接读取 self.phases 即可
        self.phases = [
            PhaseDefinition(
                idx,
                self.phase_names[idx],
                self.phase_x_positions[idx],
                self.phase_heights[idx],
                self.phase_average_heights[idx],
                self.phase_colors[idx],
                self.phase_voltages[idx],
            )
            for idx in range(len(self.phase_names))
        ]

    def _refresh_phases(self):
        """根据当前参数列表重建相定义。"""
        self.phases = [
            PhaseDefinition(
                idx,
                self.phase_names[idx],
                self.phase_x_positions[idx],
                self.phase_heights[idx],
                self.phase_average_heights[idx],
                self.phase_colors[idx],
                self.phase_voltages[idx],
            )
            for idx in range(len(self.phase_names))
        ]

    def update_parameters(
        self,
        h_s=None,
        x_s=None,
        U_max=None,
        left_ground_tilt_deg=None,
        right_ground_tilt_deg=None,
        phase_names=None,
        phase_x_positions=None,
        phase_heights=None,
        phase_average_heights=None,
        phase_colors=None,
        phase_voltages=None,
    ):
        """更新工程参数并重建相定义。"""
        if h_s is not None:
            self.h_s = float(h_s)
        if x_s is not None:
            self.x_s = float(x_s)
        if U_max is not None:
            self.U_max = float(U_max)
        if left_ground_tilt_deg is not None:
            self.left_ground_tilt_deg = float(left_ground_tilt_deg)
        if right_ground_tilt_deg is not None:
            self.right_ground_tilt_deg = float(right_ground_tilt_deg)

        if phase_names is not None:
            self.phase_names = list(phase_names)
        if phase_x_positions is not None:
            self.phase_x_positions = [float(value) for value in phase_x_positions]
        if phase_heights is not None:
            self.phase_heights = [float(value) for value in phase_heights]
        if phase_average_heights is not None:
            self.phase_average_heights = [float(value) for value in phase_average_heights]
        if phase_colors is not None:
            self.phase_colors = list(phase_colors)

        if phase_voltages is not None:
            self.phase_voltages = [float(value) for value in phase_voltages]
        else:
            self.phase_voltages = [self.U_max] + [-self.U_max / 2] * max(len(self.phase_names) - 1, 0)

        lengths = [
            len(self.phase_names),
            len(self.phase_x_positions),
            len(self.phase_heights),
            len(self.phase_average_heights),
            len(self.phase_colors),
            len(self.phase_voltages),
        ]
        if len(set(lengths)) != 1:
            raise ValueError("所有三相参数列表长度必须一致")

        self._refresh_phases()

    def get_radii_bishan(self, I, h_av, u_ph):
        """计算当前工况下的地线击距、导线击距和大地击距。"""
        # rs：地线击距，决定地线屏蔽半径
        rs = 10 * (I ** 0.65)

        # rc：导线击距，决定导线外侧的几何范围
        term = 5.015 * (I ** 0.578) - 0.001 * u_ph
        rc = 1.63 * (term ** 1.125)

        # rg：大地击距，按导线高度分段处理
        if h_av < 40:
            rg = (3.6 + 1.7 * np.log(43 - h_av)) * (I ** 0.65)
        else:
            rg = 5.5 * (I ** 0.65)
        return rs, rc, rg

    def _ground_height(self, x):
        """计算给定横坐标处的地面高度。"""
        x_array = np.asarray(x)
        left_rad = np.deg2rad(self.left_ground_tilt_deg)
        right_rad = np.deg2rad(self.right_ground_tilt_deg)
        heights = np.where(
            x_array < 0,
            -x_array * np.tan(left_rad),
            x_array * np.tan(right_rad),
        )
        if np.isscalar(x):
            return float(heights)
        return heights

    def build_state(self, I_current, h_o, theta, side="left"):
        """根据当前电流和地物高度，生成整张图需要的几何状态。"""
        # 移除底层隐藏的黑盒符号反转逻辑，使得系统对绝对坐标“所见即所得”
        x_multiplier = 1.0
        
        # 先计算地线击距，用它初始化显示范围
        rs, _, _ = self.get_radii_bishan(I_current, 40, 0)
        tower_top_x = 0.0
        shield_center_x = self.x_s * x_multiplier
        phase_states = []
        history_arcs = []

        # 这些值用于前端自动缩放画布，避免图形被裁掉
        min_x = min(0.0, shield_center_x - rs)
        max_x = max(0.0, shield_center_x + rs)
        terrain_edge_y = self._ground_height(np.array([min_x, max_x]))
        min_y = min(0.0, h_o, float(np.min(terrain_edge_y)))
        max_y = max(self.h_s + rs, h_o, float(np.max(terrain_edge_y)))

        for i, phase in enumerate(self.phases):
            # 如果是右侧，按照双回线路“逆相序”排列，颠倒电气属性（名称、颜色、电压）
            if side == "right":
                rev_idx = len(self.phases) - 1 - i
                effective_phase = PhaseDefinition(
                    id=phase.id,
                    name=self.phases[rev_idx].name,
                    x=phase.x,
                    h=phase.h,
                    h_av=phase.h_av,
                    color=self.phases[rev_idx].color,
                    u=self.phases[rev_idx].u,
                )
            else:
                effective_phase = phase

            # 镜像导线横坐标
            px = effective_phase.x * x_multiplier
            
            # 逐相计算击距圆、暴露区域和遮蔽结果
            _, rc, rg = self.get_radii_bishan(I_current, effective_phase.h_av, effective_phase.u)
            x_rc = px + rc * np.cos(theta)
            y_rc = effective_phase.h + rc * np.sin(theta)
            terrain_y = self._ground_height(x_rc)
            protection_y = terrain_y + h_o + rg

            # 与地线的距离判断：如果离地线太近，视为被屏蔽
            dist_to_s = np.sqrt((x_rc - shield_center_x) ** 2 + (y_rc - self.h_s) ** 2)

            # 地物抬升后的防护线：随地面坡度变化
            ground_limit = protection_y

            # 暴露判定：同时满足以下条件才算“暴露”
            # 1) 没有被地线屏蔽
            # 2) 高度高于大地防护线
            mask = (dist_to_s > rs) & (y_rc > ground_limit)

            # 层间互屏蔽：后面的相要再检查是否被前面的相挡住
            for prev_px, prev_ph, prev_rc in history_arcs:
                dist_to_prev = np.sqrt((x_rc - prev_px) ** 2 + (y_rc - prev_ph) ** 2)
                mask &= (dist_to_prev > prev_rc)

            # 统计暴露弧长度，供前端展示
            exposed_points = np.sum(mask)  # 暴露点数
            total_points = len(mask)  # 总采样点数
            exposed_ratio = exposed_points / total_points if total_points > 0 else 0  # 暴露比例
            exposed_length = exposed_ratio * 2 * np.pi * rc if rc > 0 else 0.0
            
            phase_states.append(
                # 把每一相的计算结果打包给前端
                PhaseState(
                    definition=effective_phase,
                    rc=rc,
                    rg=rg,
                    x_rc=x_rc,
                    y_rc=y_rc,
                    terrain_y=terrain_y,
                    protection_y=protection_y,
                    mask=mask,
                    exposed_length=exposed_length,
                    ground_limit=ground_limit,
                )
            )

            # 当前相的结果记录下来，供下一相做互屏蔽判断
            history_arcs.append((px, effective_phase.h, rc))

            # 持续更新画布范围
            min_x = min(min_x, px - rc)
            max_x = max(max_x, px + rc)
            min_y = min(min_y, effective_phase.h - rc, float(np.min(ground_limit)))
            max_y = max(max_y, effective_phase.h + rc, float(np.max(ground_limit)))

        return {
            "rs": rs,
            "tower_top_x": tower_top_x,
            "shield_center_x": shield_center_x,
            "left_ground_tilt_deg": self.left_ground_tilt_deg,
            "right_ground_tilt_deg": self.right_ground_tilt_deg,
            "phase_states": phase_states,
            "bounds": (min_x, max_x, min_y, max_y),
        }

    def find_max_backflash_current(self, h_o, theta, side="left"):
        """
        计算给定地物高度 h_o 下的最大绕击雷电流。
        
        绕击雷电流是指：导线能被屏蔽线和大地防护线完全保护的最大雷电流。
        超过此电流，导线就会开始暴露。
        
        参数：
        - h_o: 地物高度 (m)
        - theta: 圆周采样角度数组
        - side: "left" 或 "right"，用于指定计算哪一侧
        
        返回：最大绕击雷电流 (kA) 或 None (如果在整个范围内都有暴露)
        """
        # 定义搜索范围
        I_low, I_high = 2.0, 120.0
        tolerance = 0.5  # 精度：0.5 kA
        
        def has_exposure(I_current):
            """检查该电流下是否有任何导线暴露。"""
            state_result = self.build_state(I_current, h_o, theta, side=side)
            for phase_state in state_result["phase_states"]:
                if phase_state.exposed_length > 0.1:  # 允许0.1m的数值误差
                    return True
            return False
        
        # 二分法搜索临界电流
        # low = 最后一个有暴露的电流，high = 最后一个无暴露的电流
        while I_high - I_low > tolerance:
            I_mid = (I_low + I_high) / 2.0
            if has_exposure(I_mid):
                I_low = I_mid  # 有暴露，需要提高电流
            else:
                I_high = I_mid  # 无暴露，说明临界点在下方
        
        # 返回 high = 最大的完全屏蔽电流
        return round(I_high, 1)