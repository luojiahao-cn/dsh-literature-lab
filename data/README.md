# 期刊/会议等级数据

## `venues-ccf.json`

- 来源：CCF 推荐国际学术会议和期刊目录（2026 年 3 月第七版）的结构化版本
- 上游整理：https://github.com/0xca1x/ccf-catalog-analysis
- 条数：682
- 字段：category / type / rank / abbr / full_name / publisher / url
- 用途：按 full_name 或 abbr 匹配，给出 CCF A/B/C

CCF 目录版权归中国计算机学会；这里只存检索所需的精简字段，并在 UI 标注来源。

## `venues-sjr.json.gz`

- 来源：SCImago Journal & Country Rank（SJR）年度数据
- 上游 CSV：https://github.com/Michael-E-Rose/SCImagoJournalRankIndicators
- 原始站点：https://www.scimagojr.com/journalrank.php
- 年份：2025
- 去重后期刊：30,412
- 字段：`n` 名称、`i` ISSN、`s` SJR、`q` 四分位、`f` Scimago field code、`y` 年份、`p` 百分位

**四分位说明**：`q` 不是 Scimago 官方 subject quartile，而是按 `field` 内 SJR 排名计算的近似四分位：

```text
Q1 = 前 25%
Q2 = 25%–50%
Q3 = 50%–75%
Q4 = 后 25%
```

UI 必须标成“SJR 2025 Qx（按学科近似）”，不能标成 JCR 分区。

## 没有内置的

- **JCR**：Clarivate 商业数据库，不能抓取/再分发；
- **中科院分区**：受版权限制，且官方已宣布 2026 年后停止更新在线平台；
- 以后如接入，只能走机构授权的 API/本地导入，不随插件分发。

## 更新

替换 `venues-ccf.json` 或重新生成 `venues-sjr.json.gz` 后，调用 `reloadVenues()` 即可；历史论文的等级快照不自动改写。

## easyScholar 动态库（本机）

easyScholar API 用于补中科院分区/新锐分区/JCR：
- key 存 `state/easyscholar-key.json`，权限 0600，不进 git；
- 查询结果缓存到 `state/venues-easyscholar.json`；
- 不随插件分发，因为数据由用户自己的账号授权；
- 每次查询受账号额度限制，批量时默认约 1 秒/本。
