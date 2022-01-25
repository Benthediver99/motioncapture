import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, Text, View, Dimensions, Platform, TouchableOpacity, Button,TextInput } from 'react-native';

import { Camera } from 'expo-camera';
import * as tf from '@tensorflow/tfjs';
import * as poseDetection from '@tensorflow-models/pose-detection';
import * as ScreenOrientation from 'expo-screen-orientation';
import { cameraWithTensors } from '@tensorflow/tfjs-react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import FormData from 'form-data';
import Countdown from 'react-countdown';

const TensorCamera = cameraWithTensors(Camera);

const IS_ANDROID = Platform.OS === 'android';
const IS_IOS = Platform.OS === 'ios';

// Camera preview size.
//
// From experiments, to render camera feed without distortion, 16:9 ratio
// should be used fo iOS devices and 4:3 ratio should be used for android
// devices.
//
// This might not cover all cases.
const CAM_PREVIEW_WIDTH = Dimensions.get('window').width /1.25;
const CAM_PREVIEW_HEIGHT = CAM_PREVIEW_WIDTH / (IS_IOS ? 9 / 16 : 3 / 4);

// The score threshold for pose detection results.
const MIN_KEYPOINT_SCORE = 0.7;

// The size of the resized output from TensorCamera.
//
// For movenet, the size here doesn't matter too much because the model will
// preprocess the input (crop, resize, etc). For best result, use the size that
// doesn't distort the image.
const OUTPUT_TENSOR_WIDTH = 180;
const OUTPUT_TENSOR_HEIGHT = OUTPUT_TENSOR_WIDTH / (IS_IOS ? 9 / 16 : 3 / 4);

// Whether to auto-render TensorCamera preview.
const AUTO_RENDER = false;

export default function App() {
  const cameraRef = useRef(null);
  const [currentPoseName, setCurrentPoseName] = useState('');
  const [tfReady, setTfReady] = useState(false);
  const [detector, setDetector] = useState(null);
  const [poses, setPoses] = useState(null);
  const [fps, setFps] = useState(0);
  const [jsonPose, setJsonPose] = useState(null);
  const [orientation, setOrientation] =
    useState(ScreenOrientation.Orientation);
  const [cameraType, setCameraType] = useState(Camera.Constants.Type.front);
  const [frameCount, setFrameCount] = useState(0);
  const [timerCount, setTimerCount] = useState(0);
  const [tempFrameCount, setTempFrameCount] = useState(0);
  const [dataStatus, setDataStatus] = useState('');

  useEffect(() => {
    async function prepare() {
      // Set initial orientation.
      const curOrientation = await ScreenOrientation.getOrientationAsync();
      setOrientation(curOrientation);

      // Listens to orientation change.
      ScreenOrientation.addOrientationChangeListener((event) => {
        setOrientation(event.orientationInfo.orientation);
      });

      // Camera permission.
      await Camera.requestCameraPermissionsAsync();

      // Wait for tfjs to initialize the backend.
      await tf.ready();

      // Load Blazepose model.
      const detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.BlazePose,
        {
          modelType: 'full',
          enableSmoothing: true,
          runtime: 'tfjs'
        }
      );
      setDetector(detector);
      // Ready!
      setTfReady(true);
    }

    prepare();
  }, []);

  const handleCameraStream = async (
    images,
    updatePreview,
    gl
  ) => {
    const loop = async () => {
      // Get the tensor and run pose detection.
      const image = images.next().value;
      const estimationConfig = {flipHorizontal: true};
      const timestamp = performance.now();
      const poses = await detector.estimatePoses(image, estimationConfig, timestamp);
      const latency = performance.now() - timestamp;
      setFps(Math.floor(1000 / latency));
      setPoses(poses);
      if(tempFrameCount>0) {  //will run when timer hits 0 for 
                              //pose record button
        setCurrentPoseJson();
        sendPoseData();
        setTempFrameCount(tempFrameCount-1);  //keeps track of frames sent
      }
      if(poses.length>0){
        //console.log("3dPose data", poses[0].keypoints3D)
        setJsonPose(poses[0].keypoints3D)
      }
      //setJsonPose(poses.keypoints);
      tf.dispose([image]);

      // Render camera preview manually when autorender=false.
      if (!AUTO_RENDER) {
        updatePreview();
        gl.endFrameEXP();
      }

      requestAnimationFrame(loop);
    };

    loop();
  };

  const renderPose = () => {
    if (poses != null && poses.length > 0) {
      const keypoints = poses[0].keypoints
        .filter((k) => (k.score ?? 0) > MIN_KEYPOINT_SCORE)
        .map((k) => {
          // Flip horizontally on android.
          const x = IS_ANDROID ? OUTPUT_TENSOR_WIDTH - k.x : k.x;
          const y = k.y;
          let cx =
            (x / getOutputTensorWidth()) *
            (isPortrait() ? CAM_PREVIEW_WIDTH : CAM_PREVIEW_HEIGHT);
          let cy =
            (y / getOutputTensorHeight()) *
            (isPortrait() ? CAM_PREVIEW_HEIGHT : CAM_PREVIEW_WIDTH);
          if(k.score>MIN_KEYPOINT_SCORE){
          return (
            <Circle
              key={`skeletonkp_${k.name}`}
              cx={cx}
              cy={cy}
              r='4'
              strokeWidth='2'
              fill='#8B008B'
              stroke='white'
            />
          );}
        });

      const skeleton = poseDetection.util.getAdjacentPairs(poseDetection.SupportedModels.BlazePose).map(([i, j],index) => {
        const keypoints = poses[0].keypoints;
        const kp1 = keypoints[i];
        const kp2 = keypoints[j];
        const x1 = IS_ANDROID ? OUTPUT_TENSOR_WIDTH - kp1.x : kp1.x;
        const y1 = kp1.y
        const x2 = IS_ANDROID ? OUTPUT_TENSOR_WIDTH - kp2.x : kp2.x;
        const y2 = kp2.y

        const cx1 =
            (x1 / getOutputTensorWidth()) *
            (isPortrait() ? CAM_PREVIEW_WIDTH : CAM_PREVIEW_HEIGHT);
        const cy1 =
            (y1 / getOutputTensorHeight()) *
            (isPortrait() ? CAM_PREVIEW_HEIGHT : CAM_PREVIEW_WIDTH);
        const cx2 =
            (x2 / getOutputTensorWidth()) *
            (isPortrait() ? CAM_PREVIEW_WIDTH : CAM_PREVIEW_HEIGHT);
        const cy2 =
            (y2 / getOutputTensorHeight()) *
            (isPortrait() ? CAM_PREVIEW_HEIGHT : CAM_PREVIEW_WIDTH);
        if(kp1.score>MIN_KEYPOINT_SCORE){
        return (<Line
          key={`skeletonls_${index}`}
          x1={cx1}
          y1={cy1}
          x2={cx2}
          y2={cy2}
          r='4'
          stroke='red'
          strokeWidth='1'
        />);}
      });

      return <Svg style={styles.svg}>{skeleton}{keypoints}</Svg>;
    } else {
      return <View></View>;
    }
  };

  const setCurrentPoseJson = () => {
    //console.log('setting pose json', poses.length)
    setJsonPose(poses[0].keypoints3D);
  };

  const getCurrentPoseData = () => {
    const poseObj = {
      name: currentPoseName,
      keypoints: jsonPose
    }
    const poseObjStr = JSON.stringify(poseObj);
    //console.log("poseObjectStr: ", poseObjStr);
    return poseObjStr;
  };

  const sendPoseData = async () => {
    const poseData = getCurrentPoseData();
    
    //using FormData to create body data for the request
    var formData = new FormData();
    formData.append('secret', 'uindy');
    formData.append('data', poseData);
    //console.log(poseData)

    let postData = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'multipart/form-data'
      },
      body: formData
    };
    const response = await fetch('http://3.20.237.206/pose_handler.php', postData);
    const response_data = await JSON.stringify(response);
    //console.log(response_data);
    
  };

  const renderFps = () => {
    return (
      <View style={styles.fpsContainer}>
        <Text>FPS: {fps}</Text>
      </View>
    );
  };

  const isPortrait = () => {
    return (
      orientation === ScreenOrientation.Orientation.PORTRAIT_UP ||
      orientation === ScreenOrientation.Orientation.PORTRAIT_DOWN
    );
  };

  const getOutputTensorWidth = () => {
    // On iOS landscape mode, switch width and height of the output tensor to
    // get better result. Without this, the image stored in the output tensor
    // would be stretched too much.
    //
    // Same for getOutputTensorHeight below.
    return isPortrait() || IS_ANDROID
      ? OUTPUT_TENSOR_WIDTH
      : OUTPUT_TENSOR_HEIGHT;
  };

  const getOutputTensorHeight = () => {
    return isPortrait() || IS_ANDROID
      ? OUTPUT_TENSOR_HEIGHT
      : OUTPUT_TENSOR_WIDTH;
  };

  const getTextureRotationAngleInDegrees = () => {
    // On Android, the camera texture will rotate behind the scene as the phone
    // changes orientation, so we don't need to rotate it in TensorCamera.
    if (IS_ANDROID) {
      return 0;
    }

    // For iOS, the camera texture won't rotate automatically. Calculate the
    // rotation angles here which will be passed to TensorCamera to rotate it
    // internally.
    switch (orientation) {
      // Not supported on iOS as of 11/2021, but add it here just in case.
      case ScreenOrientation.Orientation.PORTRAIT_DOWN:
        return 180;
      case ScreenOrientation.Orientation.LANDSCAPE_LEFT:
        return 270;
      case ScreenOrientation.Orientation.LANDSCAPE_RIGHT:
        return 90;
      default:
        return 0;
    }
  };

  if (!tfReady) {
    return (
      <View style={styles.loadingMsg}>
        <Text>Loading...</Text>
      </View>
    );
  } else {

    const cameraTypeHandler = () => {
      if(cameraType === Camera.Constants.Type.back){
        setCameraType(Camera.Constants.Type.front);
      }else{
        setCameraType(Camera.Constants.Type.back);
      }
    };

    // const countDownTimer = (time) => {
    //   if(time > 0)
    //   {
    //     return (
    //       <View style={styles.timer}>
    //         <Text>{time}</Text>
    //       </View>
    //     );
    //   }else
    //   {
    //     return (null);
    //   }
    // }

    const countdownPoseDataSender = () => {
      var tempTimer = timerCount
      for(let i=0; i<tempTimer; i--)
      {
        // const timer = setTimeout(() => {countDownTimer(tempTimer);}, 1000);
        // clearTimeout(timer);
        
      }
      setTempFrameCount(frameCount);
    };

    const timerRenderer = ({ completed }) => {
      if (completed) {
        setTempFrameCount(frameCount);
        setDataStatus("Pose Data Sent!");
      } 
      // else {
      //   // Render a countdown
      //   return <span>{seconds}</span>;
      // }
    };

    const renderCountdown = () => {
      return(
        <Countdown
          date={Date.now() + timerCount}
          timerRenderer={timerRenderer}
        />
      );
    };

    return (
      // Note that you don't need to specify `cameraTextureWidth` and
      // `cameraTextureHeight` prop in `TensorCamera` below.
      <View
        style={
          isPortrait() ? styles.containerPortrait : styles.containerLandscape
        }
      >
        <TensorCamera
          ref={cameraRef}
          style={styles.camera}
          type={cameraType}
          autorender={AUTO_RENDER}
          type={cameraType}
          // tensor related props
          resizeWidth={getOutputTensorWidth()}
          resizeHeight={getOutputTensorHeight()}
          resizeDepth={3}
          rotation={getTextureRotationAngleInDegrees()}
          onReady={handleCameraStream}
        />
        <Button
          onPress={cameraTypeHandler}
          title="Switch"/>
        {renderPose()}
        {renderFps()}
        <TextInput
          style={styles.input}
          onChangeText={currentPoseName => setCurrentPoseName(currentPoseName)}
          value={currentPoseName}
          placeholder="Type in pose name to be trained"
          keyboardType="default"
        />
        <TextInput
          style={styles.input}
          onChangeText={setTimerCount}
          value={timerCount.toString()}
          placeholder="countdown before sending"
          keyboardType="number-pad"
        />
        <TextInput
          style={styles.input}
          onChangeText={setFrameCount}
          value={frameCount.toString()}
          placeholder="number of frames to send"
          keyboardType="number-pad"
        />
        <Button
          title="Record and Send Pose Data"
          color="#f194ff"
          onPress={() => {renderCountdown(); setDataStatus("Sending Pose Data");}}
        />
        <Text>{dataStatus}</Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  containerPortrait: {
    position: 'relative',
    width: CAM_PREVIEW_WIDTH,
    height: CAM_PREVIEW_HEIGHT,
    marginTop: Dimensions.get('window').height / 2 - CAM_PREVIEW_HEIGHT / 2,
  },
  containerLandscape: {
    position: 'relative',
    width: CAM_PREVIEW_HEIGHT,
    height: CAM_PREVIEW_WIDTH,
    marginLeft: Dimensions.get('window').height / 2 - CAM_PREVIEW_HEIGHT / 2,
  },
  loadingMsg: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  camera: {
    width: '100%',
    height: '100%',
    zIndex: 2,
  },
  svg: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    zIndex: 30,
  },
  fpsContainer: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 80,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, .7)',
    borderRadius: 2,
    padding: 8,
    zIndex: 20,
  },
  timer: {
    position: 'absolute',
    opacity: 0.5,
    top: 0.5,
    left: 0.5,
  },
});