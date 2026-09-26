const maxJsonBodyBytes = 16 * 1024;

function requestBodyError(status, message) {
  return { status, message };
}

function contentTypeIsJson(req) {
  const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  return contentType === "application/json";
}

async function readJsonRequestBody(req, options = {}) {
  const maxBytes = options.maxBytes ?? maxJsonBodyBytes;
  if (!contentTypeIsJson(req)) return { error: requestBodyError(415, "Content-Type 必须是 application/json") };
  const declaredLength = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return { error: requestBodyError(413, "Request body too large") };
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) return { error: requestBodyError(413, "Request body too large") };
      chunks.push(chunk);
    }
  } catch {
    return { error: requestBodyError(400, "Bad request") };
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return { error: requestBodyError(400, "Invalid JSON body") };
  }
  return { value };
}

export { maxJsonBodyBytes, readJsonRequestBody };
