/** Retry one reset while reading from a freshly started packaged server. */
export async function fetchStagedGetAfterReset(url, headers, fetchImpl = fetch) {
  const request = () => fetchImpl(url, { headers, signal: AbortSignal.timeout(15_000) });
  try {
    return await request();
  } catch (error) {
    if (!["ECONNRESET", "UND_ERR_SOCKET"].includes(error?.cause?.code)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return request();
  }
}
