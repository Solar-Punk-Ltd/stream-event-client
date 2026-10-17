/**
 * Bee's own answer for something it does not hold. The JSON body matters: a 404 without it is what a public
 * gateway's front door answers for a route it refuses, which the Bee provider reads differently.
 */
export function beeNotFound(): Response {
  return new Response(JSON.stringify({ code: 404, message: 'Not Found' }), {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
