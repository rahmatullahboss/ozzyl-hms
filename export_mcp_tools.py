import json
import subprocess
import os
import sys
import time

def get_tools_from_server(server_name, config):
    print(f"--- Extracting tools from {server_name} ---")
    
    cmd = [config['command']] + config.get('args', [])
    env = os.environ.copy()
    if 'env' in config:
        env.update(config['env'])
    
    # Ensure command is reachable
    if cmd[0] == 'npx':
        # Use absolute path for npx if needed, or trust shell
        pass

    try:
        process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env
        )

        def send_request(method, params=None, req_id=1):
            req = {
                "jsonrpc": "2.0",
                "id": req_id,
                "method": method,
                "params": params or {}
            }
            process.stdin.write(json.dumps(req) + "\n")
            process.stdin.flush()

        # Step 1: Initialize
        send_request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "mmx-exporter", "version": "1.0.0"}
        }, req_id=101)

        # Step 2: Wait for initialize response
        init_done = False
        start_time = time.time()
        while time.time() - start_time < 5:
            line = process.stdout.readline()
            if not line: break
            try:
                res = json.loads(line)
                if res.get("id") == 101:
                    init_done = True
                    # Send initialized notification
                    process.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
                    process.stdin.flush()
                    break
            except: continue

        if not init_done:
            print(f"Failed to initialize {server_name}")
            process.terminate()
            return []

        # Step 3: List tools
        send_request("tools/list", req_id=102)
        start_time = time.time()
        while time.time() - start_time < 5:
            line = process.stdout.readline()
            if not line: break
            try:
                res = json.loads(line)
                if res.get("id") == 102:
                    tools = res.get("result", {}).get("tools", [])
                    process.terminate()
                    return tools
            except: continue

    except Exception as e:
        print(f"Error with {server_name}: {e}")
    finally:
        try: process.terminate()
        except: pass
    return []

def main():
    mcp_config_path = os.path.expanduser("~/.claude/mcp.json")
    if not os.path.exists(mcp_config_path):
        print("mcp.json not found")
        return

    with open(mcp_config_path, 'r') as f:
        config = json.load(f)

    tools_dir = os.path.expanduser("~/.mmx/tools")
    os.makedirs(tools_dir, exist_ok=True)

    all_exported_count = 0
    for name, server_config in config.get('mcpServers', {}).items():
        if name == "MiniMax": continue # Skip self
        
        tools = get_tools_from_server(name, server_config)
        if tools:
            print(f"Found {len(tools)} tools in {name}")
            for tool in tools:
                # Convert to mmx format (just the tool definition)
                mmx_tool = {
                    "name": tool["name"],
                    "description": tool.get("description", ""),
                    "parameters": tool.get("inputSchema", {"type": "object", "properties": {}})
                }
                
                file_name = f"{name}_{tool['name']}.json"
                with open(os.path.join(tools_dir, file_name), 'w') as tf:
                    json.dump(mmx_tool, tf, indent=2)
                all_exported_count += 1
        else:
            print(f"No tools found for {name}")

    print(f"\nDone! Exported {all_exported_count} tools to {tools_dir}")

if __name__ == "__main__":
    main()
