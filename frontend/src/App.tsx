import { useState, useEffect, useRef } from 'react'
import './App.css'

interface PhaseInfo {
  name: string
  color: string
  x: number
  h: number
  rc: number
  rg: number
  exposed_length: number
  has_exposure: boolean
  x_rc: number[]
  y_rc: number[]
  protection_y: number[]
  mask: boolean[]
}

interface EGMState {
  summary: {
    side: string
    rs: number
    shield_center_x: number
    h_s: number
    total_exposure: boolean
  }
  bounds: [number, number, number, number]
  phases: PhaseInfo[]
}

function App() {
  const [ICurrent, setICurrent] = useState<number>(10.0)
  const [ho, setHo] = useState<number>(10.0)
  const [side, setSide] = useState<string>('left')
  
  const [hs, setHs] = useState<number>(54.0)
  const [xs, setXs] = useState<number>(-2.05)
  const [Umax, setUmax] = useState<number>(408.2)
  const [leftTilt, setLeftTilt] = useState<number>(0.0)
  const [rightTilt, setRightTilt] = useState<number>(0.0)
  
  const [phaseXStr, setPhaseXStr] = useState<string>('-3.4, -4.2, -3.4')
  const [phaseHStr, setPhaseHStr] = useState<string>('44.7, 40.8, 36.8')
  const [phaseHavStr, setPhaseHavStr] = useState<string>('37.43, 33.47, 29.47')
  
  const [egmState, setEgmState] = useState<EGMState | null>(null)
  const [maxBackflash, setMaxBackflash] = useState<number | null>(null)
  
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const toggleSide = (newSide: string) => {
    if (side === newSide) return
    setSide(newSide)
    setXs(-xs)
    const newPhaseX = phaseXStr.split(',').map(s => {
      const v = parseFloat(s.trim())
      return isNaN(v) ? s.trim() : (-v).toString()
    }).join(', ')
    setPhaseXStr(newPhaseX)
  }

  // 请求后端
  useEffect(() => {
    const fetchEGM = async () => {
      try {
        const parseFloats = (str: string) => str.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n))
        
        const payload = {
            I_current: ICurrent,
            h_o: ho,
            side: side,
            h_s: hs,
            x_s: xs,
            U_max: Umax,
            left_ground_tilt_deg: leftTilt,
            right_ground_tilt_deg: rightTilt,
            phase_x_positions: parseFloats(phaseXStr),
            phase_heights: parseFloats(phaseHStr),
            phase_average_heights: parseFloats(phaseHavStr)
        }
        
        const [res, maxRes] = await Promise.all([
          fetch('/api/v1/egm/calculate_state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }),
          fetch('/api/v1/egm/max_backflash', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
        ])
        
        const data = await res.json()
        const maxData = await maxRes.json()
        
        setEgmState(data)
        setMaxBackflash(maxData.max_backflash_current)
      } catch (err) {
        console.error("无法连接到后端计算 API", err)
      }
    }
    fetchEGM()
  }, [ICurrent, ho, side, hs, xs, Umax, leftTilt, rightTilt, phaseXStr, phaseHStr, phaseHavStr])

  // Canvas 绘制逻辑
  useEffect(() => {
    if (!egmState || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 获取画布宽高
    const width = canvas.width
    const height = canvas.height
    ctx.clearRect(0, 0, width, height)

    // 固定视口比例：无论雷电流怎么变，画布坐标系只基于杆塔物理尺寸和 10kA 时的近似击距来锚定
    // 这样能够保证塔和导线大小绝对固定，不会忽大忽小
    const fixed_rs = 45 // 10kA 时的典型击距 (约 44.6m)
    const margin = 10

    let maxPhaseAbsX = 0
    let maxPhaseH = egmState.summary.h_s
    egmState.phases.forEach(p => {
       maxPhaseAbsX = Math.max(maxPhaseAbsX, Math.abs(p.x))
       maxPhaseH = Math.max(maxPhaseH, p.h)
    })

    // 强制画布左右完全对称，保证塔永远在正中央
    const maxAbsX = Math.max(maxPhaseAbsX + fixed_rs, Math.abs(egmState.summary.shield_center_x) + fixed_rs) + margin
    const mathMinX = -maxAbsX
    const mathMaxX = maxAbsX

    // 固定Y轴原点为地面（Y=0），并保证能看到地物和塔顶上方的击距圆弧（按 10kA 大小预留空间）
    const bottomPad = 25
    const maxY = Math.max(maxPhaseH + fixed_rs, ho + fixed_rs)
    const mathMinY = -bottomPad
    const mathMaxY = maxY + margin

    // 坐标映射（保持 1:1 比例，图形才不畸变）
    const scaleX = width / (mathMaxX - mathMinX)
    const scaleY = height / (mathMaxY - mathMinY)
    const scale = Math.min(scaleX, scaleY)

    // X 轴居中，Y 轴底部对齐（地面固定在下方）
    const xOffset = (width - (mathMaxX - mathMinX) * scale) / 2
    const yOffset = 0

    const toScrX = (valX: number) => xOffset + (valX - mathMinX) * scale
    // SVG/Canvas Y轴向下，数学Y轴向上，所以要做反转
    const toScrY = (valY: number) => height - (yOffset + (valY - mathMinY) * scale)

    // 计算对应 x 的实际地面高度
    const getTerrainY = (valX: number) => {
      if (valX < 0) {
         return -valX * Math.tan(leftTilt * Math.PI / 180)
      } else {
         return valX * Math.tan(rightTilt * Math.PI / 180)
      }
    }

    // 画地面（考虑地面倾角）
    ctx.beginPath()
    for (let px = 0; px <= width; px += 5) {
      const mathX = mathMinX + (px / scale)
      const mathY = getTerrainY(mathX)
      if (px === 0) ctx.moveTo(px, toScrY(mathY))
      else ctx.lineTo(px, toScrY(mathY))
    }
    ctx.strokeStyle = '#555'
    ctx.lineWidth = 2
    ctx.stroke()

    // 绘制地物抬升（考虑地面倾角）
    ctx.beginPath()
    for (let px = 0; px <= width; px += 5) {
      const mathX = mathMinX + (px / scale)
      const mathY = getTerrainY(mathX) + ho
      if (px === 0) ctx.moveTo(px, toScrY(mathY))
      else ctx.lineTo(px, toScrY(mathY))
    }
    ctx.strokeStyle = '#d35400'
    ctx.setLineDash([10, 10])
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.setLineDash([])

    // 绘制干塔
    const towerX = toScrX(0)
    const towerBaseY = toScrY(getTerrainY(0))
    const hsScrY = toScrY(egmState.summary.h_s)
    ctx.beginPath()
    ctx.moveTo(towerX, towerBaseY)
    ctx.lineTo(towerX, hsScrY)
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.4)'
    ctx.lineWidth = 14
    ctx.stroke()
    
    // 绘制地线中心
    const sx = toScrX(egmState.summary.shield_center_x)
    ctx.beginPath()
    ctx.arc(sx, hsScrY, 5, 0, Math.PI * 2)
    ctx.fillStyle = '#ff4757'
    ctx.fill()

    // 绘制保护圆（以 shield_center 为圆心，rs为半径）的简单线框
    ctx.beginPath()
    ctx.arc(sx, hsScrY, egmState.summary.rs * scale, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'
    ctx.lineWidth = 1
    ctx.stroke()

    // 逐相绘制
    egmState.phases.forEach(phase => {
      // 导线中心十字符号
      const px = toScrX(phase.x)
      const ph = toScrY(phase.h)
      ctx.beginPath()
      ctx.moveTo(px - 5, ph - 5)
      ctx.lineTo(px + 5, ph + 5)
      ctx.moveTo(px + 5, ph - 5)
      ctx.lineTo(px - 5, ph + 5)
      ctx.strokeStyle = phase.color
      ctx.lineWidth = 2
      ctx.stroke()

      // 绘制击距圆（完整虚线轨）
      ctx.beginPath()
      ctx.arc(px, ph, phase.rc * scale, 0, Math.PI * 2)
      ctx.strokeStyle = phase.color
      ctx.lineWidth = 0.5
      ctx.setLineDash([5, 5])
      ctx.stroke()
      ctx.setLineDash([])

      // 绘制对应相的地物抬升后的大地保护线 (terrainY + ho + rg)
      ctx.beginPath()
      for (let scX = 0; scX <= width; scX += 10) {
        const mathX = mathMinX + (scX / scale)
        const mathY = getTerrainY(mathX) + ho + phase.rg
        if (scX === 0) ctx.moveTo(scX, toScrY(mathY))
        else ctx.lineTo(scX, toScrY(mathY))
      }
      ctx.strokeStyle = phase.color
      ctx.lineWidth = 1
      ctx.setLineDash([15, 5, 3, 5]) // 使用点划线区分
      ctx.stroke()
      ctx.setLineDash([])

      // 绘制暴露线段，利用 x_rc, y_rc 和 mask
      if (phase.has_exposure && phase.x_rc && phase.y_rc && phase.mask) {
        ctx.beginPath()
        ctx.strokeStyle = 'red'
        ctx.lineWidth = 3
        let isDrawing = false
        for (let i = 0; i < phase.x_rc.length; i++) {
          if (phase.mask[i]) {
            const sxrc = toScrX(phase.x_rc[i])
            const syrc = toScrY(phase.y_rc[i])
            if (!isDrawing) {
               ctx.moveTo(sxrc, syrc)
               isDrawing = true
            } else {
               ctx.lineTo(sxrc, syrc)
            }
          } else {
             isDrawing = false
          }
        }
        ctx.stroke()
      }
    })

  }, [egmState, ho])


  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', backgroundColor: '#f5f6fa', color: '#2d3436', fontFamily: 'sans-serif' }}>
      
      {/* 左侧控制区与信息区 */}
      <div style={{ width: '450px', padding: '2rem', borderRight: '1px solid #dfe6e9', backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column', gap: '2rem', overflowY: 'auto' }}>
        <div>
          <h2 style={{ margin: '0 0 0.5rem 0' }}>EGM 几何模型 (专业版)</h2>
          <p style={{ color: '#636e72', fontSize: '0.9rem', margin: 0 }}>基于现代 Web 渲染技术与标准化 AI API。</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ fontWeight: 'bold' }}>雷电流 I ({ICurrent} kA)</label>
            <input 
              type="range" min="2" max="50" step="0.5" 
              value={ICurrent} onChange={(e) => setICurrent(parseFloat(e.target.value))} 
              style={{ width: '100%', accentColor: '#0984e3' }}
            />
          </div>
          <div>
            <label style={{ fontWeight: 'bold' }}>地物抬升 h_o ({ho} m)</label>
            <input 
              type="range" min="0" max="30" step="0.5" 
              value={ho} onChange={(e) => setHo(parseFloat(e.target.value))} 
              style={{ width: '100%', accentColor: '#d35400' }}
            />
          </div>
          
          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '1rem' }}>
            <button 
                onClick={() => toggleSide('left')}
                style={{ flex: 1, padding: '0.6rem', background: side === 'left' ? '#0984e3' : '#dfe6e9', color: side === 'left' ? 'white' : '#2d3436', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s' }}
            >
              观测左侧
            </button>
            <button 
                onClick={() => toggleSide('right')}
                style={{ flex: 1, padding: '0.6rem', background: side === 'right' ? '#0984e3' : '#dfe6e9', color: side === 'right' ? 'white' : '#2d3436', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s' }}
            >
              观测右侧
            </button>
          </div>
        </div>

        {/* 高级参数编辑器 */}
        <div style={{ padding: '1rem', background: '#f8f9fa', borderRadius: '8px', border: '1px solid #dfe6e9' }}>
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>⚙️ 工程参数设定</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label style={{ color: '#636e72', marginBottom: '0.2rem' }}>地线高度 (m)</label>
              <input type="number" step="0.1" value={hs} onChange={e => setHs(parseFloat(e.target.value) || 0)} style={{ width: '100%', boxSizing: 'border-box', padding: '0.4rem', border: '1px solid #dfe6e9', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label style={{ color: '#636e72', marginBottom: '0.2rem' }}>地线横坐标 (m)</label>
              <input type="number" step="0.1" value={xs} onChange={e => setXs(parseFloat(e.target.value) || 0)} style={{ width: '100%', boxSizing: 'border-box', padding: '0.4rem', border: '1px solid #dfe6e9', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label style={{ color: '#636e72', marginBottom: '0.2rem' }}>运行电压 (kV)</label>
              <input type="number" step="1" value={Umax} onChange={e => setUmax(parseFloat(e.target.value) || 0)} style={{ width: '100%', boxSizing: 'border-box', padding: '0.4rem', border: '1px solid #dfe6e9', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gridColumn: 'span 2' }}>
              <label style={{ color: '#636e72', marginBottom: '0.2rem' }}>左侧倾角 (°)</label>
              <input type="number" step="1" value={leftTilt} onChange={e => setLeftTilt(parseFloat(e.target.value) || 0)} style={{ width: '100%', boxSizing: 'border-box', padding: '0.4rem', border: '1px solid #dfe6e9', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gridColumn: 'span 2' }}>
              <label style={{ color: '#636e72', marginBottom: '0.2rem' }}>右侧倾角 (°)</label>
              <input type="number" step="1" value={rightTilt} onChange={e => setRightTilt(parseFloat(e.target.value) || 0)} style={{ width: '100%', boxSizing: 'border-box', padding: '0.4rem', border: '1px solid #dfe6e9', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gridColumn: 'span 2' }}>
              <label style={{ color: '#636e72', marginBottom: '0.2rem' }}>各相横坐标 (m) [用逗号分隔]</label>
              <input type="text" value={phaseXStr} onChange={e => setPhaseXStr(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '0.4rem', border: '1px solid #dfe6e9', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gridColumn: 'span 2' }}>
              <label style={{ color: '#636e72', marginBottom: '0.2rem' }}>各相悬挂高度 (m) [用逗号分隔]</label>
              <input type="text" value={phaseHStr} onChange={e => setPhaseHStr(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '0.4rem', border: '1px solid #dfe6e9', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gridColumn: 'span 2' }}>
              <label style={{ color: '#636e72', marginBottom: '0.2rem' }}>各相平均高度 (m) [用逗号分隔]</label>
              <input type="text" value={phaseHavStr} onChange={e => setPhaseHavStr(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '0.4rem', border: '1px solid #dfe6e9', borderRadius: '4px' }} />
            </div>
          </div>
        </div>

        {egmState && (
          <div style={{ background: '#f8f9fa', padding: '1rem', borderRadius: '8px', border: '1px solid #dfe6e9', fontSize: '0.9rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>分析状态</h3>
              {maxBackflash !== null && (
                <span style={{ background: '#0984e3', color: 'white', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold' }}>
                  最大无绕击电流: {maxBackflash} kA
                </span>
              )}
            </div>
            <p style={{ margin: '0 0 0.5rem 0' }}><strong>地线击距 rs:</strong> {egmState.summary.rs.toFixed(2)} m</p>
            <hr style={{ borderColor: '#dfe6e9', margin: '1rem 0' }} />
            {egmState.phases.map(p => (
              <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: p.color, fontWeight: 'bold' }}>{p.name}</span>
                {p.has_exposure ? (
                    <span style={{ color: '#d63031', fontWeight: 'bold' }}>暴露 {p.exposed_length.toFixed(2)} m</span>
                ) : (
                    <span style={{ color: '#00b894' }}>完全屏蔽</span>
                )}
              </div>
            ))}
          </div>
        )}

      </div>

      {/* 右侧绘图区 */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', padding: '1.5rem', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <canvas 
          ref={canvasRef}
          width={1200}
          height={850}
          style={{ width: '100%', height: '100%', background: '#ffffff', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}
        />
        
        {/* 图例 */}
        {egmState && (
          <div style={{ position: 'absolute', top: '2.5rem', left: '3rem', background: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(4px)', padding: '1rem', borderRadius: '8px', border: '1px solid #dfe6e9', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', fontSize: '0.85rem' }}>
            <h4 style={{ margin: '0 0 0.8rem 0' }}>图例说明</h4>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}><div style={{ width: '14px', height: '14px', borderRadius: '50%', background: '#ff4757' }}></div> 地线及保护域</div>
            {egmState.phases.map(p => (
               <div key={`legend-${p.name}`} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}><div style={{ width: '14px', height: '14px', borderRadius: '50%', background: p.color }}></div> {p.name} 及击距轨迹</div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}><div style={{ width: '16px', height: '3px', background: '#d35400', borderStyle: 'dashed' }}></div> 地物抬升限界 (h_o)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}><div style={{ width: '16px', height: '1px', borderTop: '2px solid #555', borderStyle: 'none none dashed none' }}></div> 各相大地保护线 (h_o + rg)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}><div style={{ width: '16px', height: '3px', background: '#e74c3c' }}></div> 雷击暴露弧</div>
          </div>
        )}

        {egmState && egmState.summary.total_exposure && (
            <div style={{ position: 'absolute', top: '2.5rem', right: '3rem', background: 'rgba(214, 48, 49, 0.1)', padding: '0.8rem 1.5rem', borderRadius: '8px', color: '#d63031', fontWeight: 'bold', border: '1px solid rgba(214, 48, 49, 0.3)', boxShadow: '0 4px 12px rgba(214, 48, 49, 0.1)' }}>
                ⚠ 存在雷击暴露风险
            </div>
        )}
      </div>

    </div>
  )
}

export default App
