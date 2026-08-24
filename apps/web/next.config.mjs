/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        // 127.0.0.1 لا localhost: Node 24 يحلّ localhost إلى ::1 أولاً،
        // والـ API يستمع على IPv4 فقط — فيفشل الوكيل بلا رسالة واضحة.
        destination: `${process.env.API_URL ?? 'http://127.0.0.1:3001'}/api/:path*`,
      },
    ];
  },
};
export default nextConfig;
