import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'config.dart';

void main() {
  runApp(const EiApp());
}

class EiApp extends StatelessWidget {
  const EiApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFF0E7490),
        useMaterial3: true,
      ),
      home: const H5ViewPage(),
    );
  }
}

/// 全屏 H5 容器：加载 [AppConfig.h5Url]。
///
/// 说明：webview_flutter 的 Web 实现（webview_flutter_web）只支持
/// loadRequest，其余 API 在 Web 上会抛异常，所以用 kIsWeb 做了隔离，
/// 保证 `flutter run -d chrome` 也能用来快速预览。
class H5ViewPage extends StatefulWidget {
  const H5ViewPage({super.key});

  @override
  State<H5ViewPage> createState() => _H5ViewPageState();
}

class _H5ViewPageState extends State<H5ViewPage> {
  late final WebViewController _webView;
  int _progress = 0;
  bool _loadFailed = false;

  @override
  void initState() {
    super.initState();

    _webView = WebViewController();
    if (!kIsWeb) {
      _webView
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setBackgroundColor(const Color(0xFFFFFFFF))
        ..setNavigationDelegate(
          NavigationDelegate(
            onProgress: (int progress) {
              if (mounted) setState(() => _progress = progress);
            },
            onPageStarted: (_) {
              if (mounted) setState(() => _loadFailed = false);
            },
            onPageFinished: (_) {
              if (mounted) setState(() => _progress = 100);
            },
            onWebResourceError: (WebResourceError error) {
              // 只有主文档加载失败才整页报错，图片等子资源失败不打扰用户。
              if ((error.isForMainFrame ?? true) && mounted) {
                setState(() => _loadFailed = true);
              }
            },
          ),
        );
    }
    _webView.loadRequest(Uri.parse(AppConfig.h5Url));
  }

  Future<void> _reload() async {
    setState(() {
      _loadFailed = false;
      _progress = 0;
    });
    await _webView.loadRequest(Uri.parse(AppConfig.h5Url));
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (bool didPop, Object? result) async {
        if (didPop || kIsWeb) return;
        // 安卓返回键：先在 H5 内部后退，退无可退才退出 App。
        if (await _webView.canGoBack()) {
          await _webView.goBack();
        } else {
          await SystemNavigator.pop();
        }
      },
      child: Scaffold(
        body: SafeArea(
          child: Stack(
            children: [
              WebViewWidget(controller: _webView),
              if (!kIsWeb && _progress < 100 && !_loadFailed)
                Align(
                  alignment: Alignment.topCenter,
                  child: LinearProgressIndicator(value: _progress / 100),
                ),
              if (_loadFailed) _buildErrorView(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildErrorView() {
    final colors = Theme.of(context).colorScheme;
    return Positioned.fill(
      child: ColoredBox(
        color: colors.surface,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.wifi_off_rounded, size: 56, color: colors.outline),
              const SizedBox(height: 12),
              const Text('页面加载失败，请检查网络后重试'),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: _reload,
                icon: const Icon(Icons.refresh),
                label: const Text('重试'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
