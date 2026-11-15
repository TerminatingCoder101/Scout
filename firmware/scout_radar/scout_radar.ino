/* Scout Radar / Arduino UNO R3
 * Serial: 115200, newline-delimited JSON output.
 * Commands: SCAN, AIM <0..180>, STATUS <PASS|WARN|FAIL>, STOP, PING, IMU
 * Dependencies: Arduino AVR core (Wire) and Servo library.
 * 15 pings x 37 angles at 60 ms spacing takes about 40 seconds, not 15.
 */
#include <Servo.h>
#include <Wire.h>
#include <math.h>
#include <string.h>
#include <stdlib.h>

const uint8_t SERVO_PIN=9, TRIG_PIN=10, ECHO_PIN=11;
const uint8_t RED_PIN=5, GREEN_PIN=6, BUZZER_PIN=7, BUTTON_PIN=2;
uint8_t imuAddress=0x68;
bool imuAvailable=false;
uint8_t imuIdentity=0;
uint8_t imuFailure=0; // 1=not detected, 2=I2C read, 3=invalid acceleration
const unsigned long PING_SPACING_MS=60;
Servo turret;
char command[64];
uint8_t commandLength=0;
bool scanning=false, stopRequested=false, buttonPrevious=HIGH;
unsigned long lastButton=0;

void error(const __FlashStringHelper *message){
 Serial.print(F("{\"type\":\"error\",\"message\":\""));Serial.print(message);Serial.println(F("\"}"));
}
void pollCommands();
bool pauseMs(unsigned long duration){
 unsigned long start=millis();
 while(millis()-start<duration){pollCommands();if(stopRequested)return false;delay(1);}
 return true;
}
bool initializeIMU(){
 // Compatible MPU accelerometer register maps: 6050, 6500, 9250 and 9255.
 imuFailure=1;
 for(uint8_t address=0x68;address<=0x69;address++){
  Wire.beginTransmission(address);Wire.write(0x75);
  if(Wire.endTransmission(false)!=0)continue;
  if(Wire.requestFrom(address,(uint8_t)1,(uint8_t)true)!=1)continue;
  uint8_t identity=Wire.read();imuIdentity=identity;
  if(identity!=0x71&&identity!=0x68&&identity!=0x70&&identity!=0x73)continue;
  imuAddress=address;
  Wire.beginTransmission(address);Wire.write(0x6B);Wire.write(0);
  if(Wire.endTransmission()!=0)return false;
  Wire.beginTransmission(address);Wire.write(0x1C);Wire.write(0);
  if(Wire.endTransmission()!=0)return false;
  imuFailure=0;delay(100);return true;
 }
 return false;
}
bool readIMU(float &pitch,float &roll){
 if(!imuAvailable){imuFailure=1;return false;}
 Wire.beginTransmission(imuAddress);Wire.write(0x3B);
 if(Wire.endTransmission(false)!=0){imuFailure=2;return false;}
 if(Wire.requestFrom(imuAddress,(uint8_t)6,(uint8_t)true)!=6){imuFailure=2;return false;}
 int16_t ax=(Wire.read()<<8)|Wire.read();
 int16_t ay=(Wire.read()<<8)|Wire.read();
 int16_t az=(Wire.read()<<8)|Wire.read();
 float x=ax/16384.0f,y=ay/16384.0f,z=az/16384.0f;
 float norm=sqrt(x*x+y*y+z*z);
 if(norm<0.7f||norm>1.3f){imuFailure=3;return false;}
 imuFailure=0;
 pitch=atan2(x,sqrt(y*y+z*z))*180.0f/PI;
 roll=atan2(y,sqrt(x*x+z*z))*180.0f/PI;
 return true;
}
bool stillness(bool reportErrors){
 float meanP=0,meanR=0,m2P=0,m2R=0;
 for(int n=1;n<=25;n++){
  float p,r;if(!readIMU(p,r)){if(reportErrors){
   if(imuFailure==1)error(F("IMU not detected. Check sensor identity, power, SDA/SCL and firmware support."));
   else if(imuFailure==2)error(F("IMU I2C read failed. Check wiring and power."));
   else error(F("IMU acceleration is outside stationary range. Keep rig still and check mounting/power."));
  }return false;}
  float dp=p-meanP,dr=r-meanR;meanP+=dp/n;meanR+=dr/n;m2P+=dp*(p-meanP);m2R+=dr*(r-meanR);
  if(reportErrors){if(!pauseMs(20))return false;}else delay(20);
 }
 bool still=m2P/24<0.08f&&m2R/24<0.08f;
 Serial.print(F("{\"type\":\"tilt\",\"pitch_deg\":"));Serial.print(meanP,3);
 Serial.print(F(",\"roll_deg\":"));Serial.print(meanR,3);
 Serial.print(F(",\"still\":"));Serial.print(still?F("true"):F("false"));Serial.println(F("}"));
 if(!still&&reportErrors)error(F("Stillness check failed. Hold the rig still and retry."));
 return still;
}
void sortValues(float *a,uint8_t n){
 for(uint8_t i=1;i<n;i++){float value=a[i];int j=i-1;while(j>=0&&a[j]>value){a[j+1]=a[j];j--;}a[j+1]=value;}
}
float medianOf(float *a,uint8_t n){return n%2?a[n/2]:(a[n/2-1]+a[n/2])/2;}
float ping(){
 digitalWrite(TRIG_PIN,LOW);delayMicroseconds(2);digitalWrite(TRIG_PIN,HIGH);delayMicroseconds(10);digitalWrite(TRIG_PIN,LOW);
 unsigned long duration=pulseIn(ECHO_PIN,HIGH,24000UL);
 float cm=duration*0.0343f/2;
 return duration>0&&cm>=2&&cm<=400?cm:-1;
}
void sendPoint(int angle){
 float readings[15],deviations[15];uint8_t count=0;
 for(uint8_t i=0;i<15;i++){
  unsigned long start=millis();float d=ping();if(d>0)readings[count++]=d;
  unsigned long elapsed=millis()-start;
  if(elapsed<PING_SPACING_MS&&!pauseMs(PING_SPACING_MS-elapsed))return;
 }
 Serial.print(F("{\"type\":\"point\",\"angle_deg\":"));Serial.print(angle);
 if(count<3){Serial.print(F(",\"distance_cm\":null,\"spread_cm\":0,\"valid_pings\":"));Serial.print(count);Serial.println(F("}"));return;}
 sortValues(readings,count);float med=medianOf(readings,count);
 for(uint8_t i=0;i<count;i++)deviations[i]=fabs(readings[i]-med);
 sortValues(deviations,count);float mad=medianOf(deviations,count),cutoff=max(1.0f,3.0f*mad);
 // Spread before filtering records unstable echoes instead of hiding them.
 float spread=readings[count-1]-readings[0];uint8_t retained=0;
 for(uint8_t i=0;i<count;i++)if(fabs(readings[i]-med)<=cutoff)readings[retained++]=readings[i];
 Serial.print(F(",\"distance_cm\":"));Serial.print(medianOf(readings,retained),2);
 Serial.print(F(",\"spread_cm\":"));Serial.print(spread,2);
 Serial.print(F(",\"valid_pings\":"));Serial.print(retained);Serial.println(F("}"));
}
void scan(){
 scanning=true;stopRequested=false;analogWrite(RED_PIN,60);analogWrite(GREEN_PIN,70);
 Serial.println(F("{\"type\":\"started\"}"));
 if(stillness(true)){
  for(int angle=0;angle<=180&&!stopRequested;angle+=5){
   turret.write(angle);if(!pauseMs(angle==0?600:100))break;sendPoint(angle);
  }
  if(!stopRequested)Serial.println(F("{\"type\":\"done\"}"));
 }
 if(stopRequested)Serial.println(F("{\"type\":\"stopped\"}"));
 scanning=false;stopRequested=false;
}
void execute(char *cmd){
 if(strcmp(cmd,"STOP")==0){stopRequested=true;noTone(BUZZER_PIN);return;}
 if(scanning){error(F("Device busy; only STOP is accepted during a scan."));return;}
 if(strcmp(cmd,"IMU")==0){if(!imuAvailable)imuAvailable=initializeIMU();scanning=true;stopRequested=false;stillness(true);scanning=false;stopRequested=false;return;}
 if(strcmp(cmd,"SCAN")==0){scan();return;}
 if(strncmp(cmd,"AIM ",4)==0){
  char *end;long angle=strtol(cmd+4,&end,10);
  if(end==cmd+4||*end!='\0'||angle<0||angle>180){error(F("AIM requires an integer from 0 to 180."));return;}
  turret.write((int)angle);delay(650);
  Serial.print(F("{\"type\":\"aimed\",\"angle_deg\":"));Serial.print(angle);Serial.println(F("}"));return;
 }
 if(strncmp(cmd,"STATUS ",7)==0){
  const char *status=cmd+7;
  if(strcmp(status,"PASS")==0){analogWrite(RED_PIN,0);analogWrite(GREEN_PIN,150);noTone(BUZZER_PIN);}
  else if(strcmp(status,"WARN")==0){analogWrite(RED_PIN,120);analogWrite(GREEN_PIN,65);tone(BUZZER_PIN,1100,120);}
  else if(strcmp(status,"FAIL")==0){analogWrite(RED_PIN,170);analogWrite(GREEN_PIN,0);tone(BUZZER_PIN,2100,350);}
  else {error(F("Unknown status."));return;}
  Serial.println(F("{\"type\":\"status_set\"}"));return;
 }
 if(strcmp(cmd,"PING")==0){Serial.println(F("{\"type\":\"ready\",\"protocol\":1}"));return;}
 error(F("Unknown command."));
}
void pollCommands(){
 while(Serial.available()){
  char c=Serial.read();if(c=='\r')continue;
  if(c=='\n'){
   command[commandLength]='\0';commandLength=0;
   // Copy before execute, since scan's wait loop also polls input.
   char local[64];strncpy(local,command,sizeof(local));local[63]='\0';
   execute(local);
  }else if(commandLength<sizeof(command)-1){command[commandLength++]=c;}
  else{commandLength=0;error(F("Command too long."));}
 }
}
void setup(){
 Serial.begin(115200);Wire.begin();Wire.setWireTimeout(25000,true);
 pinMode(TRIG_PIN,OUTPUT);pinMode(ECHO_PIN,INPUT);pinMode(RED_PIN,OUTPUT);pinMode(GREEN_PIN,OUTPUT);pinMode(BUZZER_PIN,OUTPUT);pinMode(BUTTON_PIN,INPUT_PULLUP);
 turret.attach(SERVO_PIN);turret.write(90);
 imuAvailable=initializeIMU();
 delay(600); // Let the servo settle before the stationary startup check.
 bool startupStable=imuAvailable&&stillness(false);
 Serial.print(F("{\"type\":\"imu_check\",\"available\":"));Serial.print(imuAvailable?F("true"):F("false"));
 Serial.print(F(",\"identity\":"));Serial.print(imuIdentity);
 Serial.print(F(",\"address\":"));Serial.print(imuAddress);
 Serial.print(F(",\"stable\":"));Serial.print(startupStable?F("true"):F("false"));
 Serial.println(F(",\"reference\":\"gravity_raw\",\"auto_zeroed\":false}"));
 // Never subtract the startup surface's inclination. Backend applies saved bias once.
 Serial.println(F("{\"type\":\"ready\",\"protocol\":1}"));
}
void loop(){
 pollCommands();bool state=digitalRead(BUTTON_PIN);
 if(state==LOW&&buttonPrevious==HIGH&&millis()-lastButton>500){lastButton=millis();Serial.println(F("{\"type\":\"button\"}"));}
 buttonPrevious=state;delay(5);
}
