import pathlib
s=pathlib.Path('demo-runner.mjs').read_text()
a=s.index('if (!resumed) {\n  writeJSON(path.join(memoryDir, "calendar.json")')
b=s.index('  await closeAllEduPiRuntimes();\n}\nconst log = fs.openSync')+len('  await closeAllEduPiRuntimes();\n}\n')
s=s[:a]+pathlib.Path('seed-block.txt').read_text()+s[b:]
old='const message = `合成验收回复 ${modelCalls}：已收到 ${content.slice(0, 120)}。`;'
assert old in s
new='''const message = /先准备什么/.test(content)
    ? "张老师，今天周四，第 3 节有七年级数学《有理数的加减》。建议先做三件事：\\n1. 课前准备清单已生成，等你确认；\\n2. 张三连续三次在移项变号上出错，课前花三分钟单独强调；\\n3. “国庆后返校安排”提醒还有 1 项待审核。"
    : `收到：${content.slice(0, 60)}`;'''
s=s.replace(old,new)
s=s.replace('const chunks = message.match(/.{1,10}/gu) || [message];','const chunks = message.match(/[\\s\\S]{1,6}/gu) || [message];')
s=s.replace('隔离验收模型','EduPi 演示模型')
pathlib.Path('demo-runner2.mjs').write_text(s); print('spliced')
