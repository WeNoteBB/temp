-- 通用视频课 · 建表（与 server/migrate.mjs 的 ⑥ 保持一致）
-- 用法（在 ECS 上）：
--   mysql -u<用户> -p <库名> < /opt/pet-api/video-tables.sql
-- 然后导目录数据：
--   mysql -u<用户> -p <库名> < /opt/pet-api/video-seed.sql
-- 已经跑过 server/migrate.mjs 的话，这个文件可以跳过（IF NOT EXISTS 不会重复建）。

CREATE TABLE IF NOT EXISTS `edu_course` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subject` VARCHAR(32) NOT NULL COMMENT '科目，如 数学',
  `grade` VARCHAR(32) NOT NULL COMMENT '年级，如 六年级',
  `name` VARCHAR(128) NOT NULL COMMENT '课程名，如 2025秋下 六年级数学A+ 洪然',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '1 上架 / 0 下架',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_edu_course` (`subject`, `grade`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通用视频课 · 课程';

CREATE TABLE IF NOT EXISTS `edu_video` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `course_id` BIGINT UNSIGNED NOT NULL COMMENT 'edu_course.id',
  `seq` SMALLINT UNSIGNED NOT NULL COMMENT '文件名序号 1、2、3…',
  `lesson_name` VARCHAR(128) NOT NULL COMMENT '课名，如 圆的认识与周长 / 【真题练】圆的认识与周长',
  `lesson_type` VARCHAR(16) NOT NULL DEFAULT '' COMMENT '正课 / 真题练 等',
  `file_name` VARCHAR(255) NOT NULL COMMENT '原始文件名（含扩展名，原样保存）',
  `file_url` VARCHAR(512) NOT NULL COMMENT '实际播放地址（相对路径或完整 URL）',
  `duration_sec` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '视频总时长（首次播放后回填）',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '1 上架 / 0 下架',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_edu_video` (`course_id`, `seq`),
  KEY `idx_edu_video_course` (`course_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通用视频课 · 视频/课';

CREATE TABLE IF NOT EXISTS `edu_video_progress` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT 'user.id',
  `video_id` BIGINT UNSIGNED NOT NULL COMMENT 'edu_video.id',
  `position_sec` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '上次自然播放位置（秒）',
  `duration_sec` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '上次已知视频总时长（秒）',
  `watched_sec` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '累计有效观看秒数（墙钟）',
  `completed` TINYINT NOT NULL DEFAULT 0 COMMENT '是否看完 0/1',
  `last_played_at` DATETIME NULL COMMENT '最近一次播放时间',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_edu_video_progress` (`user_id`, `video_id`),
  KEY `idx_edu_video_progress_user` (`user_id`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通用视频课 · 每人每视频最新进度';
