vscode 로그

2026-10-30 11:02:55.271 [info] 




2026-10-30 11:02:55.282 [info] [AgentHostChannel] Registered lazy IPC channel 'agentHostProxy' (upstream: /mnt/wslg/runtime-dir/vscode-ipc-feba0e23-716b-4f43-857c-2dd7a530f482.sock)
2026-10-30 11:02:55.286 [info] Extension host agent started.
2026-10-30 11:02:55.457 [info] [127.0.0.1][0822e0f5][ManagementConnection] New connection established.
2026-10-30 11:02:55.535 [info] [AgentHostChannel] Renderer ctx=[object Object] requested connect to upstream
2026-10-30 11:02:56.564 [info] [127.0.0.1][b2b6985d][ExtensionHostConnection] New connection established.
2026-10-30 11:02:56.565 [info] [127.0.0.1][b2b6985d][ExtensionHostConnection] Starting extension host process...
2026-10-30 11:02:57.311 [info] [127.0.0.1][b2b6985d][ExtensionHostConnection] <2137> Launched Extension Host Process.
2026-10-30 11:02:57.411 [error] #1: https://main.vscode-cdn.net/extensions/marketplace.json - error GET self-signed certificate in certificate chain
2026-10-30 11:02:57.656 [info] [127.0.0.1][b2b6985d][ExtensionHostConnection] <2137> [reconnection-grace-time] Extension host: read VSCODE_RECONNECTION_GRACE_TIME=10800000ms (10800s)

2026-10-30 11:02:58.132 [info] ServerAgentHostManager: agent host started
2026-10-30 11:02:58.133 [info] [AgentHostChannel] Opening upstream to /mnt/wslg/runtime-dir/vscode-ipc-feba0e23-716b-4f43-857c-2dd7a530f482.sock
2026-10-30 11:09:57.538 [error] #3: https://main.vscode-cdn.net/extensions/marketplace.json - error GET self-signed certificate in certificate chain
2026-10-30 11:23:27.551 [info] Uninstalling extension from the profile: jf3-local.t32-assistant-wsl@0.4.42 file:///home/dylee/.vscode-server/extensions/extensions.json
2026-10-30 11:23:27.605 [info] Marked extension as removed jf3-local.t32-assistant-wsl-0.4.42
2026-10-30 11:23:27.613 [info] Successfully uninstalled extension from the profile jf3-local.t32-assistant-wsl@0.4.42 file:///home/dylee/.vscode-server/extensions/extensions.json
2026-10-30 11:23:28.951 [info] [127.0.0.1][0822e0f5][ManagementConnection] The client has disconnected gracefully, so the connection will be disposed.
2026-10-30 11:23:29.251 [info] [127.0.0.1][b2b6985d][ExtensionHostConnection] <2137> Extension Host Process exited with code: 0, signal: null.
2026-10-30 11:23:31.136 [info] [127.0.0.1][dd5fc560][ManagementConnection] New connection established.
2026-10-30 11:23:31.222 [info] [AgentHostChannel] Renderer ctx=[object Object] requested connect to upstream
2026-10-30 11:23:31.225 [info] [AgentHostChannel] Opening upstream to /mnt/wslg/runtime-dir/vscode-ipc-feba0e23-716b-4f43-857c-2dd7a530f482.sock
2026-10-30 11:23:31.487 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] New connection established.
2026-10-30 11:23:31.487 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] Starting extension host process...
2026-10-30 11:23:31.489 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] <8258> Launched Extension Host Process.
2026-10-30 11:23:31.808 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] <8258> [reconnection-grace-time] Extension host: read VSCODE_RECONNECTION_GRACE_TIME=10800000ms (10800s)

2026-10-30 11:23:32.320 [error] #5: https://main.vscode-cdn.net/extensions/marketplace.json - error GET self-signed certificate in certificate chain
2026-10-30 11:27:00.877 [info] Downloaded extension to file:///home/dylee/.vscode-server/data/CachedExtensionVSIXs/f3970c72-d75d-4749-b6f4-5b533b2ebd7c
2026-10-30 11:27:00.944 [info] Installing extension: dylee.dynsight {"installGivenVersion":true,"pinned":true,"isBuiltin":false,"isApplicationScoped":false,"profileLocation":{"$mid":1,"fsPath":"/home/dylee/.vscode-server/extensions/extensions.json","external":"file:///home/dylee/.vscode-server/extensions/extensions.json","path":"/home/dylee/.vscode-server/extensions/extensions.json","scheme":"file"},"productVersion":{"version":"1.144.0","date":"2026-10-27T20:18:03Z"}}
2026-10-30 11:27:01.078 [info] Extracted extension to file:///home/dylee/.vscode-server/extensions/dylee.dynsight-0.1.86: dylee.dynsight
2026-10-30 11:27:01.086 [info] Renamed to /home/dylee/.vscode-server/extensions/dylee.dynsight-0.1.86
2026-10-30 11:27:01.112 [info] Extension installed successfully: dylee.dynsight file:///home/dylee/.vscode-server/extensions/extensions.json
2026-10-30 11:27:01.287 [error] #6: https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery - error POST self-signed certificate in certificate chain
2026-10-30 13:35:15.386 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] The client has reconnected.
2026-10-30 13:35:22.663 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] <8258><stderr> 
<--- Last few GCs --->

[8258:0x2c3e7000]  7910016 ms: Scavenge (interleaved) 4077.5 (4090.6) -> 4075.8 (4091.6) MB, pooled: 0 MB, 11.01 / 0.00 ms  (average mu = 0.326, current mu = 0.210) allocation failure; 
[8258:0x2c3e7000]  7911169 ms: Mark-Compact 4093.4 (4109.0) -> 4088.4 (4117.3) MB, pooled: 0 MB, 1075.10 / 0.00 ms  (average mu = 0.226, current mu = 0.116) allocation failure; scavenge might not succeed

FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
----- Native stack trace -----


2026-10-30 13:35:22.675 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] <8258><stderr>  1: 0x942e80  [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:35:22.676 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] <8258><stderr>  2: 0x75f71e node::OOMErrorHandler(char const*, v8::OOMDetails const&) [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:35:22.677 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] <8258><stderr>  3: 0xc9a1e0  [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:35:22.678 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] <8258><stderr>  4: 0xc9a2cf  [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:35:22.678 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] <8258><stderr>  5: 0xf3dba5  [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:35:22.679 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] <8258><stderr>  6: 0xf4f50c  [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:35:22.680 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] <8258><stderr>  7: 0xf249c3  [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:35:22.680 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] <8258><stderr>  8: 0xef9b14  [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:35:22.681 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] <8258><stderr>  9: 0xee4ae8  [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:35:22.682 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] <8258><stderr> 10: 0xcc911a  [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:35:22.682 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] <8258><stderr> 11: 0xccadf8 v8::String::ValueView::ValueView(v8::Isolate*, v8::Local<v8::String>) [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:35:22.683 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] <8258><stderr> 12: 0xb08f3e node::StringBytes::Size(v8::Isolate*, v8::Local<v8::Value>, node::encoding) [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:35:22.683 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] <8258><stderr> 13: 0xb00a89 int node::StreamBase::WriteString<(node::encoding)1>(v8::FunctionCallbackInfo<v8::Value> const&) [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:35:22.684 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] <8258><stderr> 14: 0xb010a3 void node::StreamBase::JSMethod<&(int node::StreamBase::WriteString<(node::encoding)1>(v8::FunctionCallbackInfo<v8::Value> const&))>(v8::FunctionCallbackInfo<v8::Value> const&) [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]
15: 0x7f3a03dcf1be 

2026-10-30 13:35:35.582 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] The client has reconnected.
2026-10-30 13:35:55.827 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] The client has reconnected.
2026-10-30 13:36:16.392 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] The client has reconnected.
2026-10-30 13:36:36.635 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] The client has reconnected.
2026-10-30 13:36:44.096 [info] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] <8258> Extension Host Process exited with code: null, signal: SIGABRT.
2026-10-30 13:36:56.831 [error] [127.0.0.1][ccc9d0e1][ExtensionHostConnection] Unknown reconnection token (seen before).
2026-10-30 13:36:57.754 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] New connection established.
2026-10-30 13:36:57.754 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] Starting extension host process...
2026-10-30 13:36:57.760 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] <15086> Launched Extension Host Process.
2026-10-30 13:36:58.196 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] <15086> [reconnection-grace-time] Extension host: read VSCODE_RECONNECTION_GRACE_TIME=10800000ms (10800s)

2026-10-30 13:53:39.298 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] <15086><stderr> 
<--- Last few GCs --->

[15086:0x2b4a7000]   999063 ms: Scavenge (interleaved) 3980.8 (4062.7) -> 3964.2 (4065.4) MB, pooled: 0 MB, 10.44 / 0.00 ms  (average mu = 0.545, current mu = 0.452) allocation failure; 
[15086:0x2b4a7000]  1001532 ms: Mark-Compact 4089.5 (4177.3) -> 4073.7 (4254.7) MB, pooled: 0 MB, 2033.78 / 0.00 ms  (average mu = 0.410, current mu = 0.289) allocation failure; scavenge might not succeed

FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
----- Native stack trace -----


2026-10-30 13:53:39.301 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] <15086><stderr>  1: 0x942e80  [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:53:39.301 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] <15086><stderr>  2: 0x75f71e node::OOMErrorHandler(char const*, v8::OOMDetails const&) [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:53:39.302 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] <15086><stderr>  3: 0xc9a1e0  [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:53:39.303 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] <15086><stderr>  4: 0xc9a2cf  [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:53:39.304 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] <15086><stderr>  5: 0xf3dba5  [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:53:39.304 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] <15086><stderr>  6: 0xf4f50c  [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:53:39.305 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] <15086><stderr>  7: 0xf249c3  [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:53:39.306 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] <15086><stderr>  8: 0xef9b14  [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:53:39.306 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] <15086><stderr>  9: 0xee4ae8  [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:53:39.307 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] <15086><stderr> 10: 0xcc911a  [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:53:39.308 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] <15086><stderr> 11: 0xccadf8 v8::String::ValueView::ValueView(v8::Isolate*, v8::Local<v8::String>) [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:53:39.308 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] <15086><stderr> 12: 0xb08f3e node::StringBytes::Size(v8::Isolate*, v8::Local<v8::Value>, node::encoding) [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:53:39.309 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] <15086><stderr> 13: 0xb00a89 int node::StreamBase::WriteString<(node::encoding)1>(v8::FunctionCallbackInfo<v8::Value> const&) [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]

2026-10-30 13:53:39.309 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] <15086><stderr> 14: 0xb010a3 void node::StreamBase::JSMethod<&(int node::StreamBase::WriteString<(node::encoding)1>(v8::FunctionCallbackInfo<v8::Value> const&))>(v8::FunctionCallbackInfo<v8::Value> const&) [/home/dylee/.vscode-server/bin/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node]
15: 0x7fe4a7dcf1be 

2026-10-30 13:53:55.070 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] The client has reconnected.
2026-10-30 13:54:15.309 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] The client has reconnected.
2026-10-30 13:54:35.713 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] The client has reconnected.
2026-10-30 13:54:55.987 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] The client has reconnected.
2026-10-30 13:54:59.801 [info] [127.0.0.1][76dade9b][ExtensionHostConnection] <15086> Extension Host Process exited with code: null, signal: SIGABRT.
2026-10-30 13:55:16.176 [error] [127.0.0.1][76dade9b][ExtensionHostConnection] Unknown reconnection token (seen before).
2026-10-30 13:55:16.842 [info] [127.0.0.1][21c9837d][ExtensionHostConnection] New connection established.
2026-10-30 13:55:16.843 [info] [127.0.0.1][21c9837d][ExtensionHostConnection] Starting extension host process...
2026-10-30 13:55:16.848 [info] [127.0.0.1][21c9837d][ExtensionHostConnection] <20971> Launched Extension Host Process.
2026-10-30 13:55:17.316 [info] [127.0.0.1][21c9837d][ExtensionHostConnection] <20971> [reconnection-grace-time] Extension host: read VSCODE_RECONNECTION_GRACE_TIME=10800000ms (10800s)


