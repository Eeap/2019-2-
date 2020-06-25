//aws polly tts
const AWS = require('aws-sdk');
const fs=require('fs');
const { LineClient } = require('messaging-api-line');
require("dotenv").config({path : '.env'});

var express = require('express');
var app = express();
const line = require('@line/bot-sdk');

//papago api
var request = require('request');

//번역 api_url
var translate_api_url = 'https://openapi.naver.com/v1/papago/n2mt';

//언어감지 api_url
var languagedetect_api_url = 'https://openapi.naver.com/v1/papago/detectLangs';

// 검색 기능 api_url
var search_api_url = 'https://openapi.naver.com/v1/search/encyc.json';

//polly
const Polly =new AWS.Polly({
    signatureVersion: 'v4',
    region: 'ap-northeast-2',
    accessKeyId:process.env.accesskeyid,
    secretAccessKey:process.env.secretaccesskey
});

// Naver Auth Key
//새로 발급받은 naver papago api id, pw 입력
var client_id = process.env.client_id;
var client_secret = process.env.client_secret;
const config = {
  channelAccessToken: process.env.channelAccessToken,
  channelSecret: process.env.channelSecret,
};

// Microsoft Azure - Computer Vision REST API
let subscriptionKey = process.env.COMPUTER_VISION_SUBSCRIPTION_KEY
let endpoint = process.env.COMPUTER_VISION_ENDPOINT
if (!subscriptionKey) { throw new Error('Set your environment variables for your subscription key and endpoint.') }
var uriBase = endpoint + 'vision/v2.1/ocr'

// create LINE SDK client
const client = new line.Client(config);
const for_audio_client=LineClient.connect({
    accessToken: process.env.channelAccessToken,
    channelSecret: process.env.channelSecret,
});
// create Express app
// about Express itself: https://expressjs.com/

// register a webhook handler with middleware
// about the middleware, please refer to doc
app.use(express.static('public'));
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(200).end();
    });
});

// event handler
function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    if (event.message.type === 'image')
      return new Promise(function(resolve, reject) {
        const imageStream = fs.createWriteStream('public/image.jpeg')
        client.getMessageContent(event.message.id)
          .then((stream) => {
            stream.on('data', (chunk) => {
              imageStream.write(chunk)
            })
            stream.on('error', (err) => {
              console.log(err)
            })
            stream.on('end', () => {
              imageStream.end()
              const imageUrl = 'https://panguin.ml/image.jpeg'
              const params = {
                'language': 'unk',
                'detectOrientation': 'true',
              }
              const options = {
                uri: uriBase,
                qs: params,
                body: '{"url": ' + '"' + imageUrl + '"}',
                headers: {
                    'Content-Type': 'application/json',
                    'Ocp-Apim-Subscription-Key' : subscriptionKey
                }
              }
              request.post(options, (error, response, body) => {
                if (error) {
                  console.log('Error: ', error)
                  return
                }
                var lines = JSON.parse(body).regions[0].lines
                var detected_text = ''
                for (var i = 0; i < lines.length; i++) {
                  for (var j = 0; j < lines[i].words.length; j++)
                    detected_text += lines[i].words[j].text + ' '
                  detected_text += '\n'
                }
                console.log(detected_text)
                var text_before_translation = detected_text.split('\n').join('').toLowerCase()
                console.log(text_before_translation)

                //언어 감지 option
                var detect_options = {
                  url: languagedetect_api_url,
                  form: {'query': text_before_translation},
                  headers: {'X-Naver-Client-Id': client_id, 'X-Naver-Client-Secret': client_secret}
                }
                //papago 언어 감지
                request.post(detect_options, function (error, response, body) {
                  console.log(response.statusCode)
                  if (!error && response.statusCode == 200) {
                    var detect_body = JSON.parse(response.body)
                    var source = ''
                    var target = ''
                    var result = {type: 'text', text: ''}
                    //언어 감지가 제대로 됐는지 확인
                    console.log(detect_body.langCode)
                    //번역은 한국어->영어 / 영어->한국어만 지원
                    if (detect_body.langCode == 'ko' || detect_body.langCode == 'en') {
                      source = detect_body.langCode == 'ko' ? 'ko' : 'en'
                      target = source == 'ko' ? 'en' : 'ko'
                      //papago 번역 option
                      var options = {
                        url: translate_api_url,
                        // 한국어(source : ko), 영어(target: en), 카톡에서 받는 메시지(text)
                        form: {'source': source, 'target': target, 'text': text_before_translation},
                        headers: {'X-Naver-Client-Id': client_id, 'X-Naver-Client-Secret': client_secret}
                      }
                      // Naver Post API
                      request.post(options, function (error, response, body) {
                        // Translate API Sucess
                        if (!error && response.statusCode == 200) {
                          // JSON
                          var objBody = JSON.parse(response.body)
                          result.text = '감지된 텍스트 :\n' + detected_text + '\n번역된 텍스트 :\n' + objBody.message.result.translatedText
                          // Message 잘 찍히는지 확인
                          console.log(result.text)
                          //번역된 문장 보내기
                          client.replyMessage(event.replyToken, result).then(resolve).catch(reject)
                        }
                      })
                    }
                    // 메시지의 언어가 영어 또는 한국어가 아닐 경우
                    else {
                        result.text = '언어를 감지할 수 없습니다. \n 번역 언어는 한글 또는 영어만 가능합니다.'
                        client.replyMessage(event.replyToken, result).then(resolve).catch(reject)
                    }

                  }
                })
              })
            })
          })
      })
    else
      // ignore non-text-message event
      return Promise.resolve(null);
  }

  // 검색 기능
  else if(event.message.text.substr(0,4) == "!검색 "){
    return new Promise(function(resolve, reject) {
      var text_len = event.message.text.length;
      var title = event.message.text.substr(4, text_len - 4);
      var search_options = {
        uri : search_api_url,
        qs : {query : title, display : 1},
        headers: {'X-Naver-Client-Id': client_id, 'X-Naver-Client-Secret': client_secret}
      };
      request.get(search_options, function(error, response, body){
        if (!error && response.statusCode == 200){
          // 검색 결과가 없을 경우
          if(JSON.parse(body).items == ""){
            var result = { type : 'text', text : "검색 결과가 없습니다."};
          }
          else{
            var link = JSON.parse(body).items[0].link;
            var description = JSON.parse(body).items[0].description;
  
            var result = { type: 'text', text:
            title + " : \n" + description +
            "\n\nLink : \n" + link
            };
          }
          client.replyMessage(event.replyToken,result).then(resolve).catch(reject);
        }

      })
    })
  }
  else {
      // 번역 기능 & 음성 기능
      return new Promise(function (resolve, reject) {
          //언어 감지 option
          var detect_options = {
              url: languagedetect_api_url,
              form: {'query': event.message.text},
              headers: {'X-Naver-Client-Id': client_id, 'X-Naver-Client-Secret': client_secret}
          };
          //papago 언어 감지
          request.post(detect_options, function (error, response, body) {
              console.log(response.statusCode);
              if (!error && response.statusCode == 200) {
                  var detect_body = JSON.parse(response.body);
                  var source = '';
                  var target = '';
                  var result = {type: 'text', text: ''};
                  //언어 감지가 제대로 됐는지 확인
                  console.log(detect_body.langCode);
                  if (detect_options.form.query == '음성') {
                      console.log('audio streaming');
                      if (!error && response.statusCode == 200) {
                          console.log(response.statusCode);
                          for_audio_client.replyAudio(event.replyToken, {
                              "originalContentUrl": "https://panguin.ml/speech.m4a",
                              "duration": 24000
                          }).then(resolve).catch(reject);
                      }
                  }
                  //번역은 한국어->영어 / 영어->한국어만 지원
                  else if (detect_body.langCode == 'ko' || detect_body.langCode == 'en') {
                      source = detect_body.langCode == 'ko' ? 'ko' : 'en';
                      target = source == 'ko' ? 'en' : 'ko';
                      //papago 번역 option
                      var options = {
                          url: translate_api_url,
                          // 한국어(source : ko), 영어(target: en), 카톡에서 받는 메시지(text)
                          form: {'source': source, 'target': target, 'text': event.message.text},
                          headers: {'X-Naver-Client-Id': client_id, 'X-Naver-Client-Secret': client_secret}
                      };

                      // Naver Post API
                      request.post(options, function (error, response, body) {
                          // Translate API Sucess
                          if (!error && response.statusCode == 200) {
                              // JSON
                              var objBody = JSON.parse(response.body);
                              result.text = objBody.message.result.translatedText;
                              //번역된 문자 audio로 저장
                              if (options.form.target == 'ko') {
                                  var audio_options = {
                                      'Text': result.text,
                                      'OutputFormat': 'mp3',
                                      'VoiceId': 'Seoyeon',
                                      "LanguageCode": 'ko-KR'
                                  };
                              } else if (options.form.target == 'en') {
                                   var audio_options = {
                                      'Text': result.text,
                                      'OutputFormat': 'mp3',
                                      'VoiceId': 'Amy',
                                      "LanguageCode": 'en-US'
                                  };
                              }
                              Polly.synthesizeSpeech(audio_options, (err, data) => {
                                  console.log("check");
                                  if (err) {
                                      throw err;
                                  } else if (data) {
                                      if (data.AudioStream instanceof Buffer) {
                                          fs.writeFile("public/speech.m4a", data.AudioStream, function (err) {
                                              if (err) {
                                                  return console.log(err);
                                              }
                                              console.log("The file was saved!");
                                          });
                                      }
                                  }
                              });
                              // Message 잘 찍히는지 확인
                              console.log(result.text);
                              //번역된 문장 보내기
                              client.replyMessage(event.replyToken, result).then(resolve).catch(reject);
                          }
                      });
                  }
                  // 메시지의 언어가 영어 또는 한국어가 아닐 경우
                  else {
                      result.text = '언어를 감지할 수 없습니다. \n 번역 언어는 한글 또는 영어만 가능합니다.';
                      client.replyMessage(event.replyToken, result).then(resolve).catch(reject);
                  }

              }

          });

      });
  }
}

app.listen(80, function () {
  console.log('Linebot listening on port 80!');
});

