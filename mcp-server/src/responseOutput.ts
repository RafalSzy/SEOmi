export const MAX_RESPONSE_CHARS = 24_000;

export type JsonObject = Record<string, unknown>;

export const textResult = (payload: JsonObject, isError = false) => {
  const serialized = JSON.stringify(payload, null, 2);
  const truncated = serialized.length > MAX_RESPONSE_CHARS;
  const response = truncated
    ? { truncated: true, preview_json: serialized.slice(0, MAX_RESPONSE_CHARS) }
    : payload;
  return {
    isError,
    content: [{ type: 'text' as const, text: truncated ? `${serialized.slice(0, MAX_RESPONSE_CHARS)}\n[Output truncated.]` : serialized }],
    structuredContent: response,
  };
};
