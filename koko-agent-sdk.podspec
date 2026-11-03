require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "koko-agent-sdk"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]
  s.platforms    = { :ios => "15.0" }
  s.source       = { :git => "https://intentcomputing.cn", :tag => "#{s.version}" }
  s.source_files = "ios/KokoAgentSdk/**/*.{h,m,mm,swift}"
  s.frameworks   = "Vision", "CoreML", "WebKit"
  s.requires_arc = true

  if defined?(install_modules_dependencies)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"
  end
end
