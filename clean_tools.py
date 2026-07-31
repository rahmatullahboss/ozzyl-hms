import json
import os

def clean_tools():
    tools_dir = os.path.expanduser("~/.mmx/tools")
    if not os.path.exists(tools_dir):
        return

    for file_name in os.listdir(tools_dir):
        if not file_name.endswith(".json"): continue
        
        file_path = os.path.join(tools_dir, file_name)
        try:
            with open(file_path, 'r') as f:
                tool = json.load(f)
            
            # Remove $schema if present in parameters
            if "parameters" in tool and "$schema" in tool["parameters"]:
                del tool["parameters"]["$schema"]
                
            with open(file_path, 'w') as f:
                json.dump(tool, f, indent=2)
        except Exception as e:
            print(f"Error cleaning {file_name}: {e}")

if __name__ == "__main__":
    clean_tools()
    print("Cleaned tools schema.")
