# 项目规则

## 浏览器分析规则
- 浏览器访问网页做分析时，禁止读取页面任何图片（不调用 browser_take_screenshot，不通过 image() 读取截图，不分析图片内容），只用文本方式（snapshot / evaluate / DOM 结构 / 网络请求）分析页面。
