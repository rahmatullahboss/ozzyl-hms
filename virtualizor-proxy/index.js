export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const workerHost = url.host;
    
    // Target Origin is the Virtualizor panel address
    // We default to the HTTP port 4081 to avoid SSL errors from self-signed certificates at the origin.
    // The connection from the browser to Cloudflare will still be fully secure (HTTPS).
    const targetOrigin = env.TARGET_ORIGIN || "http://163.227.239.240:4081";
    const targetUrl = new URL(url.pathname + url.search, targetOrigin);
    
    // Copy the original headers
    const headers = new Headers(request.headers);
    
    // Set Host header to the target origin's host
    const targetHost = new URL(targetOrigin).host;
    headers.set("Host", targetHost);
    
    // Standard proxy headers
    headers.set("X-Forwarded-Host", workerHost);
    headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
    headers.set("X-Real-IP", headers.get("CF-Connecting-IP") || "");
    
    // Prepare the fetch parameters
    const requestInit = {
      method: request.method,
      headers: headers,
      redirect: "manual" // Handle redirects manually to rewrite Location headers
    };
    
    // Copy request body for POST/PUT requests
    if (request.method !== "GET" && request.method !== "HEAD") {
      requestInit.body = await request.clone().arrayBuffer();
    }
    
    try {
      let response = await fetch(targetUrl.toString(), requestInit);
      
      // Handle Redirects (3xx) so the browser doesn't get redirected to raw IP:port
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("Location");
        if (location) {
          try {
            const locationUrl = new URL(location, targetOrigin);
            // Rewrite the redirect location to point back to the Worker domain
            if (locationUrl.hostname === new URL(targetOrigin).hostname || locationUrl.hostname === "163.227.239.240") {
              locationUrl.protocol = url.protocol;
              locationUrl.host = workerHost;
              locationUrl.port = "";
            }
            
            const newHeaders = new Headers(response.headers);
            newHeaders.set("Location", locationUrl.toString());
            
            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: newHeaders
            });
          } catch (e) {
            // Pass through as is if location parsing fails
          }
        }
      }
      
      const newResponseHeaders = new Headers(response.headers);
      
      // Delete CSP header if it blocks assets
      newResponseHeaders.delete("Content-Security-Policy");
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newResponseHeaders
      });
      
    } catch (err) {
      return new Response(
        `Proxy Error: Could not connect to Virtualizor at ${targetOrigin}.\nDetails: ${err.message}\n\nPlease verify that the port is open and the IP is correct.`, 
        { status: 502, headers: { "Content-Type": "text/plain" } }
      );
    }
  }
};
