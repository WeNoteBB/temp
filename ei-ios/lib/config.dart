/// App 全局配置 —— 换 H5 地址只需要改这一个文件。
class AppConfig {
  AppConfig._();

  /// 启动时加载的 H5 地址。
  ///
  /// 正式部署后换成你的域名；
  /// 本地联调（安卓模拟器连本机）可以改成 http://10.0.2.2:8899。
  static const String h5Url = 'https://example.com';

  /// 应用名。
  static const String appName = 'EI';
}
