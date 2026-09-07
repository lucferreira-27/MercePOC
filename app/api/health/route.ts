export function GET() {
  return Response.json({
    configured: !!process.env.MERGE_GATEWAY_API_KEY,
    model: process.env.MERGE_GATEWAY_MODEL || 'zai/glm-5.3-flash',
  });
}
