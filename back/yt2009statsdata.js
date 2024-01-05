/*

// STATISTICS & DATA FOR WATCHPAGES //
yt2009, 2023-2024

*/
const search = require("./yt2009search")
const yt2009html = require("./yt2009html")
const utils = require("./yt2009utils")
const yt2009constants = require("./yt2009constants.json") 
const countries = require("./geo/country-codes.json")
const fetch = require("node-fetch")
const fs = require("fs")

function getReferalOnYt(v, callback) {
    // loop through youtube's search until we find the first video
    // linking to our target
    let page = 0;
    let firstVid;
    let estResults = 0;
    let timestamp = false;
    let callLimit = 5;
    let callsMade = 0;
    let savedVideos = []
    if(new Date(v.upload).getFullYear() < 2016) {
        timestamp = "2016"
    }
    function getNextPage() {
        search.get_search(`"www.youtube.com/watch?v=${v.id}"${timestamp ? ` before:${timestamp}` : ""}`,
        "", {"search_sort": "video_date_uploaded", "page": page}, (data => {
            callsMade++
            let videoResults = []
            data.forEach(vi => {
                if(vi.type == "metadata") {
                    estResults = vi.resultCount
                }
                if(vi.type == "video"
                && vi.id !== v.id) {
                    videoResults.push(vi)
                    savedVideos.push(vi)
                }
            })

            function detailFirstVid() {
                firstVid = savedVideos[savedVideos.length - 1]
                if(!firstVid
                || !firstVid.id) {
                    callback(false)
                    return;
                }
                yt2009html.fetch_video_data(firstVid.id, (data) => {
                    callback(data)
                }, "", "", false, false, true)
            }


            if(callLimit < callsMade) {
                detailFirstVid()
                return;
            }


            if(videoResults.length >= 20
            || (videoResults.length == 0
            && !timestamp
            && callLimit > callsMade)) {
                page = Math.floor(estResults / 20) - 1
                getNextPage()
                return;
            } else {
                detailFirstVid()
            }
        }), "", false)
    }
    getNextPage()
}

function estViewCountAtTime(v, date) {
    let timeDiff = Math.abs(new Date() - new Date(v.upload))
    let viewsBase = parseInt(v.viewCount) / timeDiff
    let ovDiff = Math.abs(new Date(date) - new Date(v.upload))
    let finalCount = viewsBase * ovDiff
    return Math.floor(finalCount)
}

// get user's country by querying their about tab
function getUserCountry(id, callback) {
    let chip = require("./proto/popularVidsChip_pb")
    let continuation = new chip.vidsChip()
    let msg = new chip.vidsChip.nestedMsg1()
    msg.setChannelid(id)
    msg.setChipparam(
        "8gYrGimaASYKJDY3NjRkNGE0LTAwMDAtMjAwOS05ZGIxLWFjM2ViMTQ4NzVhNA%3D%3D"
    )
    continuation.addMsg(msg)
    let chipToken = encodeURIComponent(Buffer.from(
        continuation.serializeBinary()
    ).toString("base64"))

    fetch(`https://www.youtube.com/youtubei/v1/browse?key=${
        yt2009html.get_api_key()
    }`, {
        "headers": yt2009constants.headers,
        "referrer": "https://www.youtube.com/",
        "referrerPolicy": "strict-origin-when-cross-origin",
        "body": JSON.stringify({
            "context": yt2009constants.cached_innertube_context,
            "continuation": chipToken
        }),
        "method": "POST",
        "mode": "cors"
    }).then(r => {r.json().then(r => {
        if(!r.onResponseReceivedEndpoints) {
            callback(false)
            return;
        }
        try {
            let vm = r.onResponseReceivedEndpoints[0].appendContinuationItemsAction
            .continuationItems[0].aboutChannelRenderer.metadata.aboutChannelViewModel
            if(vm.country) {
                callback(vm.country)
            } else {
                callback(false)
            }
        }
        catch(error) {
            callback(false)
        }
    })})
}

// loop the above
function bulkUserCountries(ids, callback) {
    let requestsMade = 0
    let countryList = []
    ids.forEach(id => {
        getUserCountry(id, (country) => {
            if(country) {countryList.push(country)}
            requestsMade++
            if(requestsMade >= ids.length) {
                callback(countryList)
            }
        })
    })
}

module.exports = {
    "mainPull": function(v, req, callback) {
        let callbacksRequired = 5;
        let callbacksMade = 0;
        let data = []


        // realistic_view_count handle
        v = JSON.parse(JSON.stringify(v))
        if(req.headers.displayed_views) {
            let views = parseInt(utils.bareCount(
                req.headers.displayed_views
            ))
            if(!isNaN(views)) {
                v.viewCount = parseInt(utils.bareCount(
                    req.headers.displayed_views
                ))
            }
        }


        // callback logic
        function markDone() {
            callbacksMade++
            if(callbacksMade >= callbacksRequired) {
                callback(data)
            }
        }

        // first referal from video
        getReferalOnYt(v, (d) => {
            if(!d) {
                markDone()
                return;
            }
            data.push({
                "type": "first-ref-search",
                "display_header": "First referral from YouTube video - ",
                "video": d,
                "approx_view": estViewCountAtTime(v, d.upload),
                "date": new Date(d.upload)
            })
            markDone()
        })


        // first referal from search
        fs.readFile("./cache_dir/search_cache.json", (err, file) => {
            file = file.toString()
            // fast find from (possibly) large json
            let find = file.indexOf(`"type":"video","id":"${v.id}"`)
            if(find == -1) {
                markDone()
                return;
            }
            let tData = file.split("")
            while(tData[find] !== "[") {
                find--
            }
            while(tData[find] !== `"`) {
                find--
            }
            let fPos = find;
            let t = file.substring(fPos, 20) // t - search query!!
            t = t.split(`"`)
            t = t[t.length - 1]
            
            // remove only_old markings
            t = t.split(" before:")[0]
            if(t == ":" || t == "") {markDone();return;}
            data.push({
                "type": "ref-found-search",
                "display_header": "First referral from YouTube search - ",
                "query": t,
                "approx_view": estViewCountAtTime(
                    v, (new Date(v.upload).getTime() + (1000 * 60 * 60 * 24 * 9))
                ),
                "date": new Date(v.upload).getTime() + (1000 * 60 * 60 * 24 * 9)
            })
            markDone()
        })

        
        // first video response if there
        if(new Date(v.upload).getFullYear() <= 2011) {
            let title = v.title.replace(/\(.*\)/g, "").trim()
            search.get_search(`"Re: ${title}" before:2012`, "",
            {"search_sort": "video_date_uploaded"}, (vdata => {
                let matchingVids = []
                vdata.forEach(v => {
                    if(v.type == "video"
                    && v.title.includes("Re: " + title)) {
                        matchingVids.push(v)
                    }
                })

                if(matchingVids.length >= 1) {
                    yt2009html.fetch_video_data(
                        matchingVids[matchingVids.length - 1].id,
                        (video => {
                            data.push({
                                "type": "ref-video-response",
                                "display_header": "First video response - ",
                                "video": video,
                                "approx_view": estViewCountAtTime(
                                    v, video.upload
                                ),
                                "date": video.upload
                            })

                            markDone()
                        }), "", "", false, false, true
                    )
                } else {
                    markDone()
                }
            }),
            "", false)
        } else {
            markDone()
        }


        // if new video and a lot of views, mark as viral
        if((new Date() - new Date(v.upload) - (1000 * 60 * 60 * 24 * 7)) < 651665357
        && v.viewCount > 100000) {
            data.push({
                "type": "viral",
                "approx_view": Math.floor(v.viewCount / 3),
                "date": new Date(v.upload).getTime() + (1000 * 60 * 60 * 24 * 3)
            })
            markDone()
        } else {
            markDone()
        }

        // audience lookup table
        let categoryLookupTable = {
            "Autos & Vehicles": [["Male", "35-44"], ["Male", "25-34"]],
            "Comedy": [["Male", "35-44"], ["Male", "25-34"], ["Female", "25-34"], ["Female", "18-24"]],
            "Education": [["Male", "18-24"], ["Male", "13-17"], ["Female", "18-24"], ["Female", "13-17"]],
            "Entertainment": [["Male", "18-24"], ["Male", "13-17"], ["Female", "18-24"], ["Female", "13-17"]],
            "Film & Animation": [["Male", "35-44"], ["Female", "25-34"]],
            "Gaming": [["Male", "18-24"], ["Male", "13-17"], ["Female", "18-24"], ["Female", "13-17"]],
            "Howto & Style": [["Female", "25-34"], ["Female", "18-24"], ["Female", "13-17"]],
            "Music": [["Male", "35-44"], ["Male", "25-34"], ["Female", "25-34"]],
            "News & Politics": [["Male", "25-34"], ["Female", "25-34"]],
            "Nonprofits & Activism": [["Male", "18-24"], ["Male", "13-17"], ["Female", "18-24"], ["Female", "13-17"]],
            "People & Blogs": [["Male", "25-34"], ["Female", "25-34"]],
            "Pets & Animals": [["Male", "13-17"], ["Female", "18-24"], ["Female", "13-17"]],
            "Science & Technology": [["Male", "35-44"], ["Male", "25-34"], ["Female", "25-34"]],
            "Sports": [["Male", "35-44"], ["Male", "25-34"]],
            "Travel & Events": [["Male", "35-44"], ["Male", "25-34"], ["Female", "35-44"], ["Female", "25-34"]]
        }
        data.push({
            "type": "audience-ages",
            "value": categoryLookupTable[v.category]
        })

        // audience countries
        let idList = []
        v.comments.slice(0, 10).forEach(c => {
            if(c.authorUrl.includes("channel/")) {
                idList.push(c.authorUrl.split("channel/")[1].split("?")[0])
            }
        })
        let codeCountries = []
        bulkUserCountries(idList, (received) => {
            received.forEach(c => {
                codeCountries.push(countries[c])
            })
            data.push({
                "type": "audience-countries",
                "friendly_names": received,
                "code_names": codeCountries
            })
            markDone()
        })
        if(idList.length == 0) {
            markDone()
        }
    }
}