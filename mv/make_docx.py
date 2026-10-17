from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_COLOR_INDEX
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import pathlib, re

BLUE = RGBColor(0x2D, 0x65, 0xD8)
INK = RGBColor(0x20, 0x24, 0x2A)
doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Cm(21), Cm(29.7)
sec.left_margin = sec.right_margin = Cm(2.2)
sec.top_margin, sec.bottom_margin = Cm(2.0), Cm(2.0)

def font(run, name="宋体", size=10.5, bold=False, color=None):
    run.font.name = name; run.font.size = Pt(size); run.font.bold = bold
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    if color is not None: run.font.color.rgb = color

st = doc.styles["Normal"]; st.font.name = "宋体"; st.font.size = Pt(10.5)
st.element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")
st.paragraph_format.line_spacing = 1.35; st.paragraph_format.space_after = Pt(4)

def rich(p, text, size=10.5, base_bold=False):
    """**bold** and 【placeholder】 (yellow highlight) inline markup."""
    for tok in re.split(r"(\*\*.+?\*\*|【.+?】)", text):
        if not tok: continue
        if tok.startswith("**"):
            r = p.add_run(tok[2:-2]); font(r, "微软雅黑", size, True, INK)
        elif tok.startswith("【"):
            r = p.add_run(tok); font(r, "微软雅黑", size, True, RGBColor(0x9A, 0x4B, 0x00)); r.font.highlight_color = WD_COLOR_INDEX.YELLOW
        else:
            r = p.add_run(tok); font(r, "宋体", size, base_bold)

def para(text, size=10.5, after=4, indent=False):
    p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(after)
    if indent: p.paragraph_format.first_line_indent = Cm(.74)
    rich(p, text, size); return p

def h1(text):
    p = doc.add_paragraph(); p.paragraph_format.space_before = Pt(12); p.paragraph_format.space_after = Pt(5); p.paragraph_format.keep_with_next = True
    r = p.add_run(text); font(r, "微软雅黑", 14, True, BLUE)
    pPr = p._p.get_or_add_pPr(); b = OxmlElement("w:pBdr"); bt = OxmlElement("w:bottom")
    for k, v in (("w:val", "single"), ("w:sz", "6"), ("w:space", "2"), ("w:color", "2D65D8")): bt.set(qn(k), v)
    b.append(bt); pPr.append(b)

def bullet(text, size=10.5):
    p = doc.add_paragraph(style="List Bullet"); p.paragraph_format.space_after = Pt(2); p.paragraph_format.left_indent = Cm(.8)
    rich(p, text, size); return p

def shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr(); sh = OxmlElement("w:shd")
    sh.set(qn("w:val"), "clear"); sh.set(qn("w:color"), "auto"); sh.set(qn("w:fill"), hexcolor); tcPr.append(sh)

def table(rows, widths, header=True, size=9.5):
    t = doc.add_table(rows=len(rows), cols=len(rows[0])); t.style = "Table Grid"; t.alignment = WD_TABLE_ALIGNMENT.CENTER; t.autofit = False
    for j, w in enumerate(widths): t.columns[j].width = Cm(w)
    for i, row in enumerate(rows):
        for j, txt in enumerate(row):
            c = t.cell(i, j); c.width = Cm(widths[j]); c.text = ""
            p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(1); p.paragraph_format.line_spacing = 1.2
            if header and i == 0:
                r = p.add_run(txt); font(r, "微软雅黑", size, True, RGBColor(255, 255, 255)); shade(c, "2D65D8")
            else:
                rich(p, txt, size)
                if not header and j == 0: shade(c, "EDF3FF")
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t

# ---------------- title ----------------
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.LEFT; p.paragraph_format.space_after = Pt(2)
r = p.add_run("参赛内容介绍"); font(r, "微软雅黑", 11, True, RGBColor(0x8A, 0x7D, 0x63))
p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(2)
r = p.add_run("EduPi —— 面向教育行业的垂类个人智能体"); font(r, "微软雅黑", 22, True, INK)
p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(8)
r = p.add_run("老师只管教书：EduPi 负责准备，教师负责确认"); font(r, "宋体", 12, False, BLUE)

# ---------------- 1 ----------------
h1("一、作品基本信息")
table([
    ["作品名称", "EduPi —— 面向教师的垂类个人智能体（EduPi Desktop 桌面端 + EduPi Core 智能体内核）"],
    ["所属组别", "【待填写：按赛事章程选择组别】"],
    ["参赛赛道", "【待填写：按赛事章程选择赛道】"],
    ["作品形态", "本地桌面应用（macOS Apple Silicon / Windows x64 / Linux x64），并可通过飞书等渠道与教师对话；开源项目"],
    ["开源地址", "桌面端 github.com/PIGU-PPPgu/edupi-desktop；智能体内核 github.com/PIGU-PPPgu/edupi"],
    ["当前版本", "桌面端 v0.3.x 系列持续发布（演示所用构建为 v0.3.69）；内核版本由 contracts/edupi-core-compat.json 固定，桌面端校验后方可使用"],
    ["演示视频", "6 分 32 秒，1920×1080，H.264（AVC）/ AAC，MP4 格式（约 23 MB）；第二部分为真实桌面客户端录屏（数据为模拟数据）"],
], [3.0, 13.6], header=False)

# ---------------- 2 ----------------
h1("二、个人 / 团队信息")
table([
    ["参赛形式", "【个人 / 团队】"],
    ["团队名称", "【待填写】"],
    ["成员及分工", "【姓名 · 角色（产品 / 智能体内核 / 桌面端 / 设计）· 单位】"],
    ["指导教师", "【如有，填写姓名与单位】"],
    ["联系方式", "【联系人 · 电话 · 邮箱】"],
], [3.0, 13.6], header=False)

# ---------------- 3 ----------------
h1("三、作品概述")
para("EduPi 是为教师打造的教育垂类个人智能体，也是一个面向教育行业的 AI Agent 引擎：它记住班级、理解语境、主动准备、谨慎交付、保留证据。它把教学任务、学生档案、校历课表、教学材料和 AI 对话放进同一个本地桌面工作台，并由 EduPi Core 在后台完成“感知—记忆—能力—交付”的闭环：教师像平时一样说话或上传文件，EduPi 自动理解意图、沉淀学生记忆，并准备家长沟通草稿、周报、备课清单等产物；所有结果都停在“待教师确认”，由教师接受、修改、拒绝或暂缓。", indent=True)
para("我们追求的不是又一个聊天框，而是教师的搭档：**记得每一个学生，懂你的日程，把事情提前准备好，最后的决定始终由教师作出。**", indent=True)

# ---------------- 4 ----------------
h1("四、作品背景")
bullet("**教师的时间被非教学事务占据。**把学校通知、表格和消息整理成日程与任务，回复家长群，撰写学生评语、周报月报，准备课前材料……这些事务高频、琐碎且必须完成，却不是教学判断本身（见项目产品蓝图 docs/PRODUCT_VISION.md 对教师高频事务的梳理）。")
bullet("**通用 AI 难以直接承担这类工作。**其一，它是被动的，教师想起来才会打开；其二，它没有记忆，每次都要重新介绍班级与学生；其三，它缺少教育边界——没有证据链、没有教师审核，外发与隐私风险也难以控制。")
bullet("**政策与评测导向。**教育部等五部门《“人工智能+教育”行动计划》（2026 年 4 月）提出构建情境化测评系统；TEACH-AI（Stanford SCALE，NeurIPS 2025）等研究强调以人为中心的共创与人机协作。EduPi 的“教师在回路”设计与这一方向一致。")
bullet("**我们的判断。**我们不是又一个通用 Agent。教育行业需要的不是“更会聊天”，而是**垂类**（教育场景、规则与技能）＋**个人**（绑定一位教师及其学生、日程、记忆）＋**智能体**（主动、可执行、可闭环）＋**教师在回路**。")

# ---------------- 5 ----------------
h1("五、产品定位与系统架构")
table([
    ["关键词", "含义"],
    ["垂类", "内置 43 个班主任场景技能（家长沟通、期末评语、周报月报、家长会方案、突发事件报告等）与教育事件规则，而非通用问答。"],
    ["个人", "围绕一位教师沉淀学生画像、班级事实与偏好；数据保存在本机，教师掌握数据目录。"],
    ["智能体", "具备感知、记忆、规划、执行、反馈的闭环：能定时准备、能主动提醒、能在授权下自主执行。"],
    ["教师在回路", "证据不足停在“待确认”；候选信息须由教师接受 / 修改 / 拒绝 / 暂缓；外发类动作默认关闭，执行后留回执。"],
], [3.0, 13.6])
para("**从一句话到一件事。**老师说出真实工作中的一句话（如“小明这周又错了三次移项”），EduPi 先**理解**（识别学生、错因、频次与时间线），再**准备**（画像更新、干预建议或家长沟通草稿），最后**交付**——教师确认后才发送或落盘；家长群内容保留审核门槛，公开资讯保留原文链接。", indent=True)
para("**系统架构。**桌面端使用 Tauri 提供原生窗口，React 工作台通过本地 Next.js 接口访问两条运行路径：（1）**教学数据路径**——桌面桥接层校验 Core 身份、契约与数据目录，经独立 Node.js 子进程提交命令并核验回执；（2）**对话路径**——Pi AgentSession 在本机执行提示与工具调用，经 SSE 流式返回，会话持久化保存。EduPi Core 采用六层架构：", indent=True)
table([
    ["层", "职责", "关键实现"],
    ["感知层", "从对话中捕捉意图（7 类规则，安全事件同轮即时响应），接入校历与课表", "perception_l4 · calendar · timetable"],
    ["记忆层", "向量语义检索、学生画像卡、四维加权排序、睡眠巩固", "memory"],
    ["潜意识层", "夜间“做梦”巩固记忆，浮现跨周期洞察与主题", "subconscious"],
    ["能力层", "6 个诊断工具 + 场景技能库，感知结果自动路由到技能", "skill_router · skills/"],
    ["调度层", "六心跳调度（早安简报、周报、周趋势、做梦等）与每小时主动巡检", "scheduler_core · feishu_bridge"],
    ["交付层", "Markdown 落盘与渠道推送，教师确认后自主执行", "delivery · execution_engine"],
], [2.2, 9.2, 5.2])
para("按 EduPi 的自治等级框架（L1 工具 → L2 助手 → L3 主动助手 → **L4 无感搭档** → L5 自主智能），当前定位为 L4：教师正常说话，背后的准备工作已经完成，由教师最终确认；L5（跨域洞察、自主执行、自我进化）仍在推进中。", indent=True)

# ---------------- 6 ----------------
h1("六、技术创新点")
items = [
    ("教育垂类六层智能体架构。", "将感知、记忆、潜意识、能力、调度、交付拆为独立层，并设计三条反馈环：教师确认 → 记忆再学习；潜意识 → 能力进化；交付 → 记忆状态同步。让“记得住、想得到、做得出、送得到”成为可检查的工程结构。"),
    ("无感感知与安全即时响应。", "教师无需选择功能，一句话即可被识别为考试、错因、进步、家长、行政、行为、安全等 7 类意图；涉及受伤、危险的安全事件在同一轮对话内即时提醒，而不等待定时任务。"),
    ("证据优先、教师在回路。", "日期不明、置信度低的信息停在“待确认”，并附原文证据；候选信息经教师接受 / 修改 / 拒绝 / 暂缓后才写入画像；任务字段固定为 teacher_internal、external_send=false、requires_teacher_review=true，所有写入留下回执并可回滚。"),
    ("学生画像与记忆连续性。", "向量语义检索 + 学生画像卡 + 四维加权排序 + 夜间睡眠巩固，使 EduPi 能在后续交互中引用此前的观察（例如同一学生同一错因连续出现 3 次触发辅导方案）。"),
    ("本地优先的契约化桥接。", "桌面端与 Core 之间以固定版本的兼容契约、独立进程与独立数据根目录对接；教学事实、任务会话绑定与模型凭据分开存放，任意版本的 Core 不能替代固定运行时。"),
    ("可信的自我进化机制与证据等级。", "反复出现的模式只进入候选；必须经过真实轨迹、教师试用、独立 held-out 评估与晋级才可成为正式技能，并支持回滚。同时以 E0–E5 证据等级约束对外表述——“不自己给自己打分”。"),
    ("多 Agent 协作与可复用运行时。", "按需咨询教学分析、心理预警等专才子代理；模型、接口地址、嵌入服务与渠道（stdio / 飞书 / 自定义）均由使用者配置，教育记忆与证据边界保持不变。"),
]
for i, (a, b) in enumerate(items, 1):
    p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(3); p.paragraph_format.left_indent = Cm(.5); p.paragraph_format.first_line_indent = Cm(-.5)
    rich(p, f"{i}. **{a}**{b}")

# ---------------- 7 ----------------
h1("七、核心功能与演示视频对应")
table([
    ["视频章节", "核心功能", "说明"],
    ["01 首次进入", "新手教程与教师上下文", "七步新手教程（连接模型、确认教师资料、导入学生名单、导入校历与课表、上传第一份材料、第一次备课、进入今天）；教师上下文标明证据条数、不外发，可随时重新打开"],
    ["02 日程", "上传、接入与月历", "上传学校通知，先暂存为待接入材料，教师确认类型、学科、班级后才接入；校历、课表、任务汇总在月历中并标注来源；日期不确定的“期中考试”标为日期待确认并附原文"],
    ["03 今天 · 工作区", "简报、日程与任务看板", "今天页汇总简报、接下来的日程与待判断事项；工作区按待处理 / 进行中 / 待我确认 / 已完成推进备课任务"],
    ["04 待我确认 · 学生档案", "候选审核与班级档案", "教师随口一句话生成观察与记忆候选，附来源与证据、标明“教师内部 · 不外发”；教师接受 / 修改 / 拒绝 / 暂缓，接受后留回执；班级中每位学生有学习记录、同伴互动与家校人物"],
    ["05 教学材料", "暂存、接入与归档", "教案、通知、试卷分析按类型、学科、班级归档，可查看材料详情与来源；暂存材料可移除"],
    ["场景 A / B / C", "渠道场景（示意）", "家长沟通回复草稿（不外发）、早安简报与周报“提前一天交付”、安全事件即时提醒；该部分为示意动画，真实飞书渠道验收（E4）尚待完成"],
], [3.4, 3.4, 9.8])

# ---------------- 8 ----------------
h1("八、典型应用场景")
bullet("**班主任日常**：家长沟通话术、期末评语、周报月报、家长会方案、突发事件报告、作业缺交与请假跟进。")
bullet("**学科教师**：依据课表与校历准备课前清单；材料识别后进入备课；针对连续错因生成辅导方案。")
bullet("**校历与行政**：通知、表格自动转为待确认日程；截止日期提前提醒并生成初稿。")
bullet("**安全与心理关注**：随口一句即可触发安全提醒；多维度数据交叉发现“单域看不见”的趋势。")
bullet("**延伸方向**：教研组、年级组的共享技能与记忆；学校层面的材料与日程协同。")

# ---------------- 9 ----------------
h1("九、预期成效与评价方式")
para("**预期成效。**（1）**时间回收**——把被通知、表格和重复沟通占去的时间还给教学，项目目标是回收教师约 80% 的非教学时间（目标值，有待真实试用验证）；（2）**质量连续**——学生画像与记忆随使用不断积累，沟通与评语有据可依；（3）**安全可控**——不确定则待确认，外发默认关闭，关键事件即时提醒；（4）**教师主导**——EduPi 只准备，决定权在教师。", indent=True)
para("**评价方式。**采用 E0–E5 证据等级（代码 → 隔离测试 → 本机真实数据 → 运行时闭环 → 真实渠道 → 教师真人试用）约束“可声称”的内容；并设计 A/B 评估方案：以 22 个连续班主任场景、模拟一周的周期，对比“普通 AI 裸对话”与“EduPi 六层全开”，参考 TEACH-AI、PersonaLens 等基准的多维评分。", indent=True)
table([
    ["证据等级", "状态", "依据"],
    ["E0 代码 / E1 隔离测试", "已完成", "Core 官网所述核心测试 61 项通过，无密钥 L4 隔离测试 75/75 项通过（不含真实模型与渠道）；桌面端持续发布"],
    ["E2 本机真实数据 / E3 运行时闭环", "进行中", "桌面端已有校历、任务审核、学生与材料等闭环；macOS 安装版更新路径已在真机验证；覆盖范围仍在扩大"],
    ["E4 真实渠道", "待补齐", "真实飞书收发与 messageId 闭环尚待验证"],
    ["E5 教师真人试用", "待补齐", "真人输入、接受 / 修改 / 拒绝、held-out 与独立评估尚待开展；自我进化目前仅完成隔离机制验证"],
], [4.4, 2.2, 10.0])

# ---------------- 10 ----------------
h1("十、当前进展与后续计划")
bullet("**已完成**：桌面端（Tauri + Next.js）多平台发布与更新机制；Core 六层架构、43 个场景技能、心跳调度与飞书桥接；校历、任务、学生、材料与审核闭环。")
bullet("**近期**：统一桌面端 / Core / 渠道的运行时边界与追踪；完成真实飞书渠道验收（E4）；以真实教师材料开展 L4 验证。")
bullet("**中期**：教师真人试用与 held-out 评估（E5），在证据充分后再推进跨域洞察、主动决策与自我进化的晋级。")

# ---------------- 11 ----------------
h1("十一、数据、隐私与演示说明")
bullet("教学数据默认保存在本机；使用远程模型时，对话内容与完成请求所需的上下文会发送至所配置的模型服务方，本地存储并不等同于离线推理。")
bullet("外发类动作默认关闭，须教师明确确认；涉及学生信息的写入均需教师审核并留有回执。")
bullet("**演示视频第二部分录制自真实的 EduPi 桌面客户端（v0.3.70），运行在专门构建的隔离模拟环境中：学校通知、教师与学生姓名、材料与对话内容均为演示用虚构数据；视频中不展示模型对话；系统等待响应的片段以 8 倍速呈现并在画面上标注。这些数据并非真实学校或学生信息。**")

# ---------------- 12 ----------------
h1("附：演示视频结构")
table([
    ["部分", "时长", "内容", "赛事要求"],
    ["第一部分　作品概述", "1 分 36 秒", "教师的一周与截止（教学 / 学生 / 家校 / 行政）、幕后与垂类个人智能体定位、提醒 ≠ 交付、Core 六层与场景技能", "2 分钟内"],
    ["第二部分　核心功能演示与典型应用场景模拟", "3 分 45 秒", "新手教程与教师上下文、日程上传与接入、今天与工作区（截止前已备好的周报与计划）、待我确认与学生档案、教学材料；渠道场景示意：家长沟通、早安简报与周报提前交付、安全事件", "6 分钟内"],
    ["第三部分　用户交互过程与成效", "1 分 11 秒", "交互闭环、证据等级与当前进展、预期成效", "2 分钟内"],
    ["合计", "6 分 32 秒", "1920×1080 · 30 fps · H.264（AVC）+ AAC · MP4", "10 分钟内 / ≤ 500 MB"],
], [4.6, 2.2, 6.6, 3.2])

out = pathlib.Path(__file__).parent / "EduPi_参赛内容介绍.docx"
doc.save(out); print(out)
