function assistantOutput(session) {
  const last = [...session.state.messages].reverse().find(message => message.role === "assistant");
  const output = last?.content?.filter(block => block.type === "text").map(block => block.text).join("\n");
  if (!output || ["error", "aborted"].includes(last.stopReason)) throw new Error("model_unavailable");
  return output;
}

export async function generateValidatedArtifacts(session, prompt, candidate, validate) {
  await session.prompt(prompt);
  let output = assistantOutput(session);
  try { validate(output, candidate); return output; }
  catch (error) { if (error.code !== "invalid_model_output") throw error; }
  await session.prompt("上一条响应未通过 JSON 结构校验。请只重新输出合法 JSON，正确转义字符串内的双引号与换行，不加代码围栏；保留原有材料内容，顶层只有 artifacts，每项只有 title 和 content，标题必须严格等于：" + JSON.stringify(candidate.deliverables));
  output = assistantOutput(session);
  validate(output, candidate);
  return output;
}
