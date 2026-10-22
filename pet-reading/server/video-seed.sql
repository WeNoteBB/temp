-- 通用视频课 · 目录种子数据（由 tools/import-videos.mjs --sql 生成）
-- 先跑 server/migrate.mjs 建表，再执行本文件。
-- 导入的是目录信息，不是视频文件；视频文件放 nginx 目录/OSS。

INSERT INTO `edu_course` (`subject`, `grade`, `name`, `status`) VALUES ('数学', '六年级', '2025秋下 六年级数学A+ 洪然', 1)
ON DUPLICATE KEY UPDATE `id` = LAST_INSERT_ID(`id`), `status` = 1;
SET @course_id = LAST_INSERT_ID();

INSERT INTO `edu_video` (`course_id`, `seq`, `lesson_name`, `lesson_type`, `file_name`, `file_url`, `status`) VALUES
  (@course_id, 1, '圆的认识与周长', '正课', '1圆的认识与周长.mkv', '/videos/math/grade6/2025autumn/01.mp4', 1),
  (@course_id, 2, '【真题练】圆的认识与周长', '真题练', '2【真题练】圆的认识与周长.mkv', '/videos/math/grade6/2025autumn/02.mp4', 1),
  (@course_id, 3, '圆的面积初步', '正课', '3圆的面积初步.mkv', '/videos/math/grade6/2025autumn/03.mp4', 1),
  (@course_id, 4, '【真题练】圆的面积初步', '真题练', '4 【真题练】圆的面积初步.mp4', '/videos/math/grade6/2025autumn/04.mp4', 1),
  (@course_id, 5, '百分数的认识', '正课', '5百分数的认识.mp4', '/videos/math/grade6/2025autumn/05.mp4', 1),
  (@course_id, 6, '【真题练】百分数的认识', '真题练', '6【真题练】百分数的认识.mp4', '/videos/math/grade6/2025autumn/06.mp4', 1),
  (@course_id, 7, '百分数应用题', '正课', '7百分数应用题.mkv', '/videos/math/grade6/2025autumn/07.mp4', 1),
  (@course_id, 8, '【真题练】百分数应用题', '真题练', '8【真题练】百分数应用题.mkv', '/videos/math/grade6/2025autumn/08.mp4', 1),
  (@course_id, 9, '圆的面积进阶', '正课', '9圆的面积进阶.mp4', '/videos/math/grade6/2025autumn/09.mp4', 1),
  (@course_id, 10, '【真题练】圆的面积进阶', '真题练', '10【真题练】圆的面积进阶.mp4', '/videos/math/grade6/2025autumn/10.mp4', 1),
  (@course_id, 11, '圆的综合应用', '正课', '11圆的综合应用.mkv', '/videos/math/grade6/2025autumn/11.mp4', 1),
  (@course_id, 12, '【真题练】圆的综合应用', '真题练', '12【真题链】圆的综合应用.mkv', '/videos/math/grade6/2025autumn/12.mp4', 1),
  (@course_id, 13, '扇形统计图', '正课', '13扇形统计图.mp4', '/videos/math/grade6/2025autumn/13.mp4', 1),
  (@course_id, 14, '【真题练】扇形统计图', '真题练', '14【真题练】扇形统计图.mp4', '/videos/math/grade6/2025autumn/14.mp4', 1),
  (@course_id, 15, '按比例分配进阶', '正课', '15按比例分配进阶.mp4', '/videos/math/grade6/2025autumn/15.mp4', 1),
  (@course_id, 16, '【真题练】按比例分配进阶', '真题练', '16【真题练】按比例分配进阶.mp4', '/videos/math/grade6/2025autumn/16.mp4', 1),
  (@course_id, 17, '圆的倍数问题', '正课', '17圆的倍数问题.mp4', '/videos/math/grade6/2025autumn/17.mp4', 1),
  (@course_id, 18, '【真题练】圆的倍数问题', '真题练', '18【真题练】圆的倍数问题.mp4', '/videos/math/grade6/2025autumn/18.mp4', 1),
  (@course_id, 19, '分数应用题综合', '正课', '19分数应用题综合.mkv', '/videos/math/grade6/2025autumn/19.mp4', 1),
  (@course_id, 20, '【真题练】分数应用题综合', '真题练', '20【真题练】分数应用题综合.mkv', '/videos/math/grade6/2025autumn/20.mp4', 1),
  (@course_id, 21, '浓度问题', '正课', '21浓度问题.mp4', '/videos/math/grade6/2025autumn/21.mp4', 1),
  (@course_id, 22, '【真题练】浓度问题', '真题练', '22【真题练】浓度问题.mp4', '/videos/math/grade6/2025autumn/22.mp4', 1),
  (@course_id, 23, '百分比应用题综合', '正课', '23百分比应用题综合.mp4', '/videos/math/grade6/2025autumn/23.mp4', 1),
  (@course_id, 24, '【真题练】百分比应用题综合', '真题练', '24【真题练】百分比应用题综合.mp4', '/videos/math/grade6/2025autumn/24.mp4', 1),
  (@course_id, 25, '直击考场', '正课', '25直击考场.mp4', '/videos/math/grade6/2025autumn/25.mp4', 1),
  (@course_id, 26, '【真题练】直击考场', '真题练', '26【真题练】直击考场.mp4', '/videos/math/grade6/2025autumn/26.mp4', 1)
ON DUPLICATE KEY UPDATE
  `lesson_name` = VALUES(`lesson_name`),
  `lesson_type` = VALUES(`lesson_type`),
  `file_name` = VALUES(`file_name`),
  `file_url` = VALUES(`file_url`),
  `status` = 1;

-- 播放页 URL 用的是 edu_video.id；下面这条会打印 id 与课名，方便做链接
SELECT `id`, `seq`, `lesson_name`, `lesson_type` FROM `edu_video` WHERE `course_id` = @course_id ORDER BY `seq`;
